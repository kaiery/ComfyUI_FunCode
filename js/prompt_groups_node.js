import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

const DEFAULT_PAYLOAD = {
  version: 1,
  groups: [
    {
      id: "group_1",
      name: "Group 1",
      input_slot: 1,
      text: "",
      enabled: true,
    },
  ],
};

const cloneDefaultPayload = () => JSON.parse(JSON.stringify(DEFAULT_PAYLOAD));
let graphPromptHookInstalled = false;
const MAX_EXTERNAL_GROUP_INPUTS = 50;
const DEFAULT_TEXTAREA_HEIGHT = 96;
const MIN_TEXTAREA_HEIGHT = 40;
const MAX_TEXTAREA_HEIGHT = 520;
const TEXTAREA_BOTTOM_GAP = 4;
const NODE_BOTTOM_GUARD = 8;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `group_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parsePayload(value) {
  if (!value) return cloneDefaultPayload();
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return cloneDefaultPayload();
    if (!Array.isArray(parsed.groups)) parsed.groups = [];
    if (!parsed.groups.length) parsed.groups = cloneDefaultPayload().groups;
    parsed.version = 1;
    parsed.groups = parsed.groups.map((group, index) => ({
      id: String(group?.id || `group_${index + 1}`),
      name: String(group?.name || `Group ${index + 1}`),
      input_slot: Number.parseInt(group?.input_slot, 10),
      textarea_height: normalizeTextAreaHeight(group?.textarea_height),
      text: String(group?.text || ""),
      enabled: group?.enabled !== false,
    }));
    normalizeInputSlots(parsed.groups);
    return parsed;
  } catch (error) {
    console.warn("[FunCode] Failed to parse prompt groups payload.", error);
    return cloneDefaultPayload();
  }
}

function normalizeTextAreaHeight(value) {
  const height = Number.parseInt(value, 10);
  if (!Number.isFinite(height)) return DEFAULT_TEXTAREA_HEIGHT;
  return Math.max(MIN_TEXTAREA_HEIGHT, Math.min(MAX_TEXTAREA_HEIGHT, height));
}

function normalizeInputSlots(groups) {
  const used = new Set();
  for (const group of groups || []) {
    const slot = Number.parseInt(group?.input_slot, 10);
    if (Number.isInteger(slot) && slot >= 1 && slot <= MAX_EXTERNAL_GROUP_INPUTS && !used.has(slot)) {
      group.input_slot = slot;
      used.add(slot);
    } else {
      group.input_slot = getNextInputSlot(groups, used);
      used.add(group.input_slot);
    }
  }
}

function getNextInputSlot(groups, usedSlots = null) {
  const used = usedSlots || new Set();
  if (!usedSlots) {
    for (const group of groups || []) {
      const slot = Number.parseInt(group?.input_slot, 10);
      if (Number.isInteger(slot) && slot >= 1 && slot <= MAX_EXTERNAL_GROUP_INPUTS) used.add(slot);
    }
  }
  for (let index = 1; index <= MAX_EXTERNAL_GROUP_INPUTS; index += 1) {
    if (!used.has(index)) return index;
  }
  return null;
}

function getNextGroupName(groups) {
  const used = new Set();
  for (const group of groups || []) {
    const match = String(group?.name || "").trim().match(/^Group\s+(\d+)$/i);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isInteger(value) && value > 0) used.add(value);
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Group ${index}`;
}

function getGroupInputName(index) {
  return `group_${index}_text`;
}

function compareAsciiText(a, b, direction = "asc") {
  const left = String(a || "");
  const right = String(b || "");
  const length = Math.min(left.length, right.length);
  let result = 0;
  for (let index = 0; index < length; index += 1) {
    const diff = left.charCodeAt(index) - right.charCodeAt(index);
    if (diff !== 0) {
      result = diff;
      break;
    }
  }
  if (result === 0) result = left.length - right.length;
  return direction === "desc" ? -result : result;
}

function splitPresetPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizePresetPath(value) {
  return splitPresetPath(value).join("/");
}

function getPresetLabel(path) {
  const segments = splitPresetPath(path);
  return segments.length ? segments[segments.length - 1] : "";
}

function getPresetFolder(path) {
  const segments = splitPresetPath(path);
  return segments.length > 1 ? segments.slice(0, -1).join("/") : "";
}

function getFolderParents(path) {
  const segments = splitPresetPath(path);
  const parents = [];
  for (let index = 1; index <= segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

function normalizePresetData(data) {
  const presetMap = new Map();
  const folders = new Set();
  for (const folder of Array.isArray(data?.folders) ? data.folders : []) {
    const path = normalizePresetPath(folder);
    if (!path) continue;
    for (const parent of getFolderParents(path)) folders.add(parent);
  }
  for (const preset of Array.isArray(data?.presets) ? data.presets : []) {
    const path = normalizePresetPath(preset?.path || preset?.name);
    if (!path || presetMap.has(path)) continue;
    const folder = getPresetFolder(path);
    if (folder) {
      for (const parent of getFolderParents(folder)) folders.add(parent);
    }
    presetMap.set(path, {
      name: path,
      path,
      label: getPresetLabel(path),
      folder,
      text: String(preset?.text || ""),
    });
  }
  return {
    folders: [...folders].sort((a, b) => compareAsciiText(a, b)),
    presets: [...presetMap.values()].sort((a, b) => compareAsciiText(a.name, b.name)),
  };
}

function buildPresetTree(presets, folders, sortDirection = "asc") {
  const root = { name: "", path: "", folders: new Map(), presets: [] };
  const ensureFolder = (path) => {
    let node = root;
    let currentPath = "";
    for (const segment of splitPresetPath(path)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!node.folders.has(segment)) {
        node.folders.set(segment, { name: segment, path: currentPath, folders: new Map(), presets: [] });
      }
      node = node.folders.get(segment);
    }
    return node;
  };
  for (const folder of folders || []) ensureFolder(folder);
  for (const preset of presets || []) {
    const folder = getPresetFolder(preset.name);
    const node = folder ? ensureFolder(folder) : root;
    node.presets.push(preset);
  }
  const sortNode = (node) => {
    node.presets.sort((a, b) => compareAsciiText(a.label, b.label, sortDirection));
    node.folders = new Map([...node.folders.entries()].sort((a, b) => compareAsciiText(a[0], b[0], sortDirection)));
    for (const child of node.folders.values()) sortNode(child);
  };
  sortNode(root);
  return root;
}

function appendTreePresetOptions(select, node, depth = 0) {
  for (const preset of node.presets) {
    const option = document.createElement("option");
    option.value = preset.name;
    option.textContent = `${"  ".repeat(depth)}${preset.label || preset.name}`;
    select.appendChild(option);
  }
  for (const folder of node.folders.values()) {
    const option = document.createElement("option");
    option.value = `__folder__:${folder.path}`;
    option.textContent = `${"  ".repeat(depth)}[${folder.name}]`;
    option.disabled = true;
    select.appendChild(option);
    appendTreePresetOptions(select, folder, depth + 1);
  }
}

function appendFolderOptions(select, folders, selectedPath = "", sortDirection = "asc") {
  select.innerHTML = "";
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Folder...";
  select.appendChild(emptyOption);
  const tree = buildPresetTree([], folders, sortDirection);
  const appendFolders = (node, depth = 0) => {
    for (const folder of node.folders.values()) {
      const option = document.createElement("option");
      option.value = folder.path;
      option.textContent = `${"  ".repeat(depth)}${folder.name}`;
      select.appendChild(option);
      appendFolders(folder, depth + 1);
    }
  };
  appendFolders(tree);
  select.value = (folders || []).includes(selectedPath) ? selectedPath : "";
}

async function readPresetResponse(response, fallbackMessage) {
  const data = await response.json();
  if (!response.ok || data?.status === "error") {
    throw new Error(data?.message || fallbackMessage);
  }
  return normalizePresetData(data);
}

async function fetchPresetData() {
  const response = await api.fetchApi("/funcode/prompt_group_presets");
  const data = await response.json();
  return normalizePresetData(data);
}

async function savePreset(name, text) {
  const response = await api.fetchApi("/funcode/prompt_group_presets/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  return readPresetResponse(response, "Failed to save preset.");
}

async function deletePreset(name) {
  const response = await api.fetchApi("/funcode/prompt_group_presets/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return readPresetResponse(response, "Failed to delete preset.");
}

async function createPresetFolder(path) {
  const response = await api.fetchApi("/funcode/prompt_group_presets/folder/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return readPresetResponse(response, "Failed to create folder.");
}

async function renamePresetFolder(oldPath, newPath) {
  const response = await api.fetchApi("/funcode/prompt_group_presets/folder/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
  });
  return readPresetResponse(response, "Failed to rename folder.");
}

async function deletePresetFolder(path) {
  const response = await api.fetchApi("/funcode/prompt_group_presets/folder/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return readPresetResponse(response, "Failed to delete folder.");
}

function applyStyles(el, styles) {
  Object.assign(el.style, styles);
  return el;
}

function createButton(label, title, onClick) {
  const button = document.createElement("button");
  button.textContent = label;
  button.title = title || label;
  button.onclick = onClick;
  const normalStyle = {
    background: "#2b2b2b",
    borderColor: "#555",
    color: "#ddd",
    transform: "translateY(0)",
  };
  const hoverStyle = {
    background: "#3a3a3a",
    borderColor: "#777",
    color: "#fff",
  };
  const activeStyle = {
    background: "#1f1f1f",
    borderColor: "#8a8a8a",
    color: "#fff",
    transform: "translateY(1px)",
  };
  applyStyles(button, {
    minHeight: "18px",
    padding: "2px 6px",
    border: "1px solid #555",
    borderRadius: "4px",
    background: "#2b2b2b",
    color: "#ddd",
    cursor: "pointer",
    fontSize: "8px",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
    transition: "background 120ms ease, border-color 120ms ease, color 120ms ease, transform 60ms ease, box-shadow 120ms ease",
    userSelect: "none",
  });
  applyStyles(button, normalStyle);
  button.onmouseenter = () => applyStyles(button, hoverStyle);
  button.onmouseleave = () => {
    applyStyles(button, normalStyle);
    button.style.boxShadow = "none";
  };
  button.onmousedown = () => applyStyles(button, activeStyle);
  button.onmouseup = () => applyStyles(button, hoverStyle);
  button.onfocus = () => {
    button.style.boxShadow = "0 0 0 2px rgba(120, 170, 255, 0.35)";
  };
  button.onblur = () => {
    applyStyles(button, normalStyle);
    button.style.boxShadow = "none";
  };
  return button;
}

function createInput(value, title) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.title = title || "";
  applyStyles(input, {
    minWidth: "0",
    height: "18px",
    padding: "2px 6px",
    border: "1px solid #555",
    borderRadius: "4px",
    background: "#1f1f1f",
    color: "#ddd",
    boxSizing: "border-box",
    fontSize: "8px",
  });
  return input;
}

function createSelect(title) {
  const select = document.createElement("select");
  select.title = title || "";
  applyStyles(select, {
    minWidth: "0",
    height: "18px",
    padding: "2px 6px",
    border: "1px solid #555",
    borderRadius: "4px",
    background: "#1f1f1f",
    color: "#ddd",
    boxSizing: "border-box",
    fontSize: "10px",
  });
  return select;
}

class PromptGroupsEditor {
  constructor(node, dataWidget) {
    this.node = node;
    this.dataWidget = dataWidget;
    this.payload = parsePayload(node.properties?.prompt_groups_payload || dataWidget.value);
    this.presets = [];
    this.presetFolders = [];
    this.folderTarget = "";
    this.presetSortDirection = node.properties?.prompt_preset_sort_direction === "desc" ? "desc" : "asc";
    this.transientPresetTargets = new Map();
    this.textWidgets = new Map();
    this.groupItemElements = [];
    this.toolbarElement = null;
    this.listElement = null;
    this.resizeFrame = null;
    this.root = document.createElement("div");
    this.root.className = "funcode-prompt-groups";
    applyStyles(this.root, {
      width: "100%",
      maxWidth: "100%",
      minWidth: "0",
      boxSizing: "border-box",
      padding: "0px",
      color: "#ddd",
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      overflow: "visible",
    });
    this.persistToProperties();
    this.clearWidgetValue();
    this.render();
    this.loadPresets();
  }

  async loadPresets() {
    try {
      this.applyPresetData(await fetchPresetData());
      this.render();
    } catch (error) {
      console.error("[FunCode] Failed to load prompt group presets.", error);
    }
  }

  applyPresetData(data) {
    this.presets = Array.isArray(data?.presets) ? data.presets : [];
    this.presetFolders = Array.isArray(data?.folders) ? data.folders : [];
    if (this.folderTarget && !this.presetFolders.includes(this.folderTarget)) {
      this.folderTarget = "";
    }
  }

  sync() {
    this.persistToProperties();
    this.clearWidgetValue();
    this.node.setDirtyCanvas(true, true);
  }

  serializePayload() {
    return JSON.stringify(this.payload);
  }

  persistToProperties() {
    this.node.properties = this.node.properties || {};
    const payload = this.serializePayload();
    this.node.properties.prompt_groups_payload = payload;
    this.node.properties.prompt_preset_sort_direction = this.presetSortDirection;
    this.dataWidget.value = payload;
  }

  writeWidgetValueForPrompt() {
    this.dataWidget.value = this.serializePayload();
  }

  clearWidgetValue() {
    this.dataWidget.value = this.serializePayload();
  }

  configureFromPayloadValue(value) {
    this.payload = parsePayload(value || this.node.properties?.prompt_groups_payload || this.dataWidget.value);
    this.persistToProperties();
    this.render();
  }

  getEditorWidgetHeight() {
    if (this.groupItemElements.length === this.payload.groups.length && this.groupItemElements.length > 0) {
      const rootStyle = getComputedStyle(this.root);
      const toolbarStyle = this.toolbarElement ? getComputedStyle(this.toolbarElement) : null;
      const listStyle = this.listElement ? getComputedStyle(this.listElement) : null;
      const rootPadding =
        Number.parseFloat(rootStyle.paddingTop || "0") +
        Number.parseFloat(rootStyle.paddingBottom || "0");
      const toolbarHeight = this.toolbarElement?.offsetHeight || 0;
      const toolbarMarginBottom = toolbarStyle ? Number.parseFloat(toolbarStyle.marginBottom || "0") : 0;
      const listGap = listStyle ? Number.parseFloat(listStyle.gap || "0") : 0;
      const itemHeights = this.groupItemElements.reduce((total, item) => total + item.offsetHeight, 0);
      const gapHeight = Math.max(0, this.groupItemElements.length - 1) * listGap;
      return Math.ceil(rootPadding + toolbarHeight + toolbarMarginBottom + itemHeights + gapHeight);
    }
    const groupGap = Math.max(0, this.payload.groups.length - 1) * 8;
    const groupsHeight = this.payload.groups.reduce((total, group) => {
      return total + 62 + normalizeTextAreaHeight(group.textarea_height) + TEXTAREA_BOTTOM_GAP;
    }, 0);
    return 54 + groupsHeight + groupGap;
  }

  syncExternalInputs() {
    normalizeInputSlots(this.payload.groups);
    const activeSlots = new Set(this.payload.groups.map((group) => group.input_slot));
    for (const slot of activeSlots) {
      const inputName = getGroupInputName(slot);
      const existingInput = (this.node.inputs || []).find((input) => input.name === inputName);
      if (!existingInput) this.node.addInput(inputName, "STRING");
    }
    for (let index = (this.node.inputs || []).length - 1; index >= 0; index -= 1) {
      const input = this.node.inputs[index];
      const match = String(input?.name || "").match(/^group_(\d+)_text$/);
      if (!match) continue;
      const groupIndex = Number.parseInt(match[1], 10);
      if (!activeSlots.has(groupIndex) || groupIndex > MAX_EXTERNAL_GROUP_INPUTS) {
        this.node.removeInput(index);
      }
    }
    for (const group of this.payload.groups) {
      const inputName = getGroupInputName(group.input_slot);
      const input = (this.node.inputs || []).find((item) => item.name === inputName);
      if (input) input.label = `${group.name || "Group"} - ${inputName}`;
    }
    this.reorderExternalInputs();
  }

  reorderExternalInputs() {
    if (!this.node.inputs?.length) return;
    const desiredNames = this.payload.groups.map((group) => getGroupInputName(group.input_slot));
    const inputByName = new Map();
    const nonGroupInputs = [];
    for (const input of this.node.inputs) {
      if (/^group_\d+_text$/.test(input.name)) {
        inputByName.set(input.name, input);
      } else {
        nonGroupInputs.push(input);
      }
    }
    const orderedGroupInputs = desiredNames
      .map((name) => inputByName.get(name))
      .filter(Boolean);
    const nextInputs = [...orderedGroupInputs, ...nonGroupInputs];
    const unchanged =
      nextInputs.length === this.node.inputs.length &&
      nextInputs.every((input, index) => input === this.node.inputs[index]);
    if (unchanged) return;
    this.node.inputs = nextInputs;
    this.updateInputLinkSlots();
  }

  updateInputLinkSlots() {
    const links = this.node.graph?.links || app.graph?.links;
    if (!links || !this.node.inputs) return;
    this.node.inputs.forEach((input, index) => {
      const linkIds = Array.isArray(input.link) ? input.link : [input.link];
      for (const linkId of linkIds) {
        if (linkId == null) continue;
        const link = links[linkId];
        if (link) link.target_slot = index;
      }
    });
  }

  resizeNode() {
    const width = this.node.size?.[0] || 420;
    if (!this.node.setSize) return;
    const computed = this.node.computeSize ? this.node.computeSize() : [width, this.getEditorWidgetHeight() + 80];
    const height = Math.max(computed?.[1] || 0, this.getEditorWidgetHeight() + 72, 280) + NODE_BOTTOM_GUARD;
    this.node.setSize([width, height]);
  }

  scheduleResizeNode() {
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = null;
        this.refreshTextAreaLayout();
        this.resizeNode();
        this.node.setDirtyCanvas(true, true);
      });
    });
  }

  addGroup() {
    const inputSlot = getNextInputSlot(this.payload.groups);
    if (!inputSlot) {
      alert(`Prompt Groups supports up to ${MAX_EXTERNAL_GROUP_INPUTS} external text inputs.`);
      return;
    }
    this.payload.groups.push({
      id: makeId(),
      name: getNextGroupName(this.payload.groups),
      input_slot: inputSlot,
      text: "",
      enabled: true,
    });
    this.sync();
    this.render();
    this.scheduleResizeNode();
  }

  removeTextWidget(groupId) {
    const entry = this.textWidgets.get(groupId);
    if (!entry) return;
    entry.resizeObserver?.disconnect();
    const widgetIndex = this.node.widgets?.indexOf(entry.widget);
    if (widgetIndex >= 0) this.node.widgets.splice(widgetIndex, 1);
    if (entry.wrapper?.parentNode) entry.wrapper.parentNode.removeChild(entry.wrapper);
    if (entry.textArea?.parentNode) entry.textArea.parentNode.removeChild(entry.textArea);
    this.textWidgets.delete(groupId);
  }

  removeGroup(groupId) {
    if (this.payload.groups.length <= 1) return;
    this.payload.groups = this.payload.groups.filter((group) => group.id !== groupId);
    this.removeTextWidget(groupId);
    this.sync();
    this.render();
  }

  moveGroup(groupId, direction) {
    const index = this.payload.groups.findIndex((group) => group.id === groupId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= this.payload.groups.length) return;
    const [group] = this.payload.groups.splice(index, 1);
    this.payload.groups.splice(nextIndex, 0, group);
    this.sync();
    this.render();
  }

  findPreset(name) {
    const path = normalizePresetPath(name);
    return this.presets.find((preset) => preset.name === path);
  }

  loadPresetIntoGroup(group, name) {
    const presetName = normalizePresetPath(name);
    if (!presetName) {
      alert("Select a preset first.");
      return false;
    }
    const preset = this.findPreset(presetName);
    if (!preset) {
      alert("The selected preset no longer exists.");
      this.setPresetTarget(group, "");
      this.render();
      return false;
    }
    this.setPresetTarget(group, preset.name);
    group.text = preset.text || "";
    this.sync();
    this.render();
    return true;
  }

  getPresetTarget(group) {
    return this.transientPresetTargets.get(group.id) || "";
  }

  setPresetTarget(group, name) {
    const path = normalizePresetPath(name);
    if (!path) {
      this.transientPresetTargets.delete(group.id);
      return;
    }
    this.transientPresetTargets.set(group.id, path);
  }

  syncGroupTextFromElement(group) {
    const entry = this.textWidgets.get(group.id);
    if (!entry?.textArea) return group.text || "";
    const text = entry.textArea.value || "";
    group.text = text;
    if (entry.widget) entry.widget.value = text;
    this.persistToProperties();
    return text;
  }

  async saveSelectedPreset(group) {
    const name = this.getPresetTarget(group);
    if (!name) {
      alert("Select a preset first, or use Save As.");
      return;
    }
    if (!this.findPreset(name)) {
      alert("The selected preset no longer exists. Use Save As to create it.");
      this.setPresetTarget(group, "");
      this.render();
      return;
    }
    if (!confirm(`Overwrite local preset "${name}"?`)) return;
    try {
      const text = this.syncGroupTextFromElement(group);
      this.applyPresetData(await savePreset(name, text));
      group.text = text;
      this.setPresetTarget(group, name);
      this.render();
    } catch (error) {
      alert(error.message || "Failed to save preset.");
    }
  }

  async saveAsPreset(group) {
    const suggestedName = this.getPresetTarget(group) || (this.folderTarget ? `${this.folderTarget}/` : "");
    const rawName = prompt("Save as preset path (use / for folders):", suggestedName);
    if (rawName === null) return;
    const name = normalizePresetPath(rawName);
    if (!name) {
      alert("Preset name is required.");
      return;
    }
    if (this.findPreset(name) && !confirm(`Preset "${name}" already exists. Overwrite it?`)) return;
    try {
      const text = this.syncGroupTextFromElement(group);
      this.applyPresetData(await savePreset(name, text));
      group.text = text;
      this.setPresetTarget(group, name);
      this.render();
    } catch (error) {
      alert(error.message || "Failed to save preset.");
    }
  }

  async deleteCurrentPreset(group) {
    const name = this.getPresetTarget(group);
    if (!name) {
      alert("Select a preset first.");
      return;
    }
    if (!this.findPreset(name)) {
      alert("The selected preset no longer exists.");
      this.setPresetTarget(group, "");
      this.render();
      return;
    }
    if (!confirm(`Delete local preset "${name}"?`)) return;
    try {
      this.applyPresetData(await deletePreset(name));
      this.setPresetTarget(group, "");
      this.render();
    } catch (error) {
      alert(error.message || "Failed to delete preset.");
    }
  }

  async createFolder() {
    const rawPath = prompt("New folder path:", this.folderTarget ? `${this.folderTarget}/` : "");
    if (rawPath === null) return;
    const path = normalizePresetPath(rawPath);
    if (!path) {
      alert("Folder path is required.");
      return;
    }
    try {
      this.applyPresetData(await createPresetFolder(path));
      this.folderTarget = path;
      this.render();
    } catch (error) {
      alert(error.message || "Failed to create folder.");
    }
  }

  async renameFolder() {
    const oldPath = this.folderTarget;
    if (!oldPath) {
      alert("Select a folder first.");
      return;
    }
    const rawPath = prompt("Rename folder to:", oldPath);
    if (rawPath === null) return;
    const newPath = normalizePresetPath(rawPath);
    if (!newPath) {
      alert("Folder path is required.");
      return;
    }
    try {
      this.applyPresetData(await renamePresetFolder(oldPath, newPath));
      this.folderTarget = newPath;
      for (const [groupId, target] of [...this.transientPresetTargets.entries()]) {
        if (target.startsWith(`${oldPath}/`)) {
          this.transientPresetTargets.set(groupId, `${newPath}/${target.slice(oldPath.length + 1)}`);
        }
      }
      this.render();
    } catch (error) {
      alert(error.message || "Failed to rename folder.");
    }
  }

  async deleteFolder() {
    const path = this.folderTarget;
    if (!path) {
      alert("Select a folder first.");
      return;
    }
    const prefix = `${path}/`;
    const presetCount = this.presets.filter((preset) => preset.name.startsWith(prefix)).length;
    const detail = presetCount === 1 ? "1 preset" : `${presetCount} presets`;
    if (!confirm(`Delete folder "${path}" and ${detail}?`)) return;
    try {
      this.applyPresetData(await deletePresetFolder(path));
      this.folderTarget = "";
      for (const [groupId, target] of [...this.transientPresetTargets.entries()]) {
        if (target.startsWith(prefix)) this.transientPresetTargets.delete(groupId);
      }
      this.render();
    } catch (error) {
      alert(error.message || "Failed to delete folder.");
    }
  }

  renderPresetOptions(select, selectedName = "") {
    select.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Load preset...";
    select.appendChild(emptyOption);
    appendTreePresetOptions(select, buildPresetTree(this.presets, this.presetFolders, this.presetSortDirection));
    select.value = this.findPreset(selectedName) ? selectedName : "";
  }

  render() {
    this.root.innerHTML = "";
    this.syncExternalInputs();
    this.groupItemElements = [];
    this.toolbarElement = null;
    this.listElement = null;
    const activeGroupIds = new Set(this.payload.groups.map((group) => group.id));
    for (const groupId of [...this.textWidgets.keys()]) {
      if (!activeGroupIds.has(groupId)) this.removeTextWidget(groupId);
    }

    const toolbar = document.createElement("div");
    applyStyles(toolbar, {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "6px",
      marginBottom: "8px",
      minWidth: "0",
    });

    const title = document.createElement("div");
    title.textContent = "Prompt Groups";
    applyStyles(title, {
      flex: "1",
      minWidth: "120px",
      fontWeight: "700",
      color: "#f0f0f0",
    });

    toolbar.appendChild(title);
    toolbar.appendChild(createButton("+ Group", "Add text group", () => this.addGroup()));

    const sortSelect = createSelect("Preset list sort order");
    const ascOption = document.createElement("option");
    ascOption.value = "asc";
    ascOption.textContent = "ASCII Asc";
    sortSelect.appendChild(ascOption);
    const descOption = document.createElement("option");
    descOption.value = "desc";
    descOption.textContent = "ASCII Desc";
    sortSelect.appendChild(descOption);
    sortSelect.value = this.presetSortDirection;
    applyStyles(sortSelect, {
      flex: "0 0 84px",
    });
    sortSelect.onchange = () => {
      this.presetSortDirection = sortSelect.value === "desc" ? "desc" : "asc";
      this.persistToProperties();
      this.render();
    };
    toolbar.appendChild(sortSelect);

    const folderSelect = createSelect("Select preset folder");
    applyStyles(folderSelect, {
      flex: "1 1 150px",
      maxWidth: "220px",
    });
    appendFolderOptions(folderSelect, this.presetFolders, this.folderTarget, this.presetSortDirection);
    folderSelect.onchange = () => {
      this.folderTarget = folderSelect.value;
    };
    toolbar.appendChild(folderSelect);
    toolbar.appendChild(createButton("+ Folder", "Create preset folder", () => this.createFolder()));
    toolbar.appendChild(createButton("Rename Folder", "Rename selected preset folder", () => this.renameFolder()));
    toolbar.appendChild(createButton("Delete Folder", "Delete selected preset folder and contained presets", () => this.deleteFolder()));
    toolbar.appendChild(createButton("Refresh", "Refresh local presets", () => this.loadPresets()));
    this.toolbarElement = toolbar;
    this.root.appendChild(toolbar);

    const list = document.createElement("div");
    applyStyles(list, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      minWidth: "0",
      maxWidth: "100%",
    });
    this.listElement = list;

    this.payload.groups.forEach((group, index) => {
      const item = document.createElement("div");
      applyStyles(item, {
        border: "1px solid #444",
        borderRadius: "6px",
        padding: "7px",
        background: "#262626",
        boxSizing: "border-box",
        minWidth: "0",
        maxWidth: "100%",
        overflow: "visible",
      });

      const firstRow = document.createElement("div");
      applyStyles(firstRow, {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        alignItems: "center",
        marginBottom: "6px",
        minWidth: "0",
      });

      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = group.enabled !== false;
      enabled.title = "Enable group";
      enabled.onchange = () => {
        group.enabled = enabled.checked;
        this.sync();
      };

      const nameInput = createInput(group.name, "Workflow group name only");
      applyStyles(nameInput, {
        flex: "1 1 130px",
        maxWidth: "100%",
      });
      nameInput.oninput = () => {
        group.name = nameInput.value;
        this.syncExternalInputs();
        this.sync();
      };

      const presetSelect = createSelect("Select local preset");
      applyStyles(presetSelect, {
        flex: "1 1 150px",
        maxWidth: "100%",
      });
      this.renderPresetOptions(presetSelect, this.getPresetTarget(group));
      presetSelect.onchange = () => {
        if (!presetSelect.value) {
          this.setPresetTarget(group, "");
          return;
        }
        this.setPresetTarget(group, presetSelect.value);
      };

      const loadPresetButton = createButton("Load Preset", "Reload selected preset text into this group", () => {
        this.loadPresetIntoGroup(group, this.getPresetTarget(group) || presetSelect.value);
      });
      applyStyles(loadPresetButton, {
        flex: "0 0 auto",
      });

      firstRow.appendChild(enabled);
      firstRow.appendChild(nameInput);
      firstRow.appendChild(presetSelect);
      firstRow.appendChild(loadPresetButton);
      item.appendChild(firstRow);

      const secondRow = document.createElement("div");
      applyStyles(secondRow, {
        display: "flex",
        flexWrap: "wrap",
        gap: "5px",
        marginBottom: "6px",
        minWidth: "0",
      });

      secondRow.appendChild(createButton("Up", "Move group up", () => this.moveGroup(group.id, -1)));
      secondRow.appendChild(createButton("Down", "Move group down", () => this.moveGroup(group.id, 1)));
      secondRow.appendChild(createButton("Save Preset", "Overwrite selected local preset", () => this.saveSelectedPreset(group)));
      secondRow.appendChild(createButton("Save As", "Save this group text as a new local preset", () => this.saveAsPreset(group)));
      secondRow.appendChild(createButton("Delete Preset", "Delete selected local preset", () => this.deleteCurrentPreset(group)));
      secondRow.appendChild(createButton("Remove", "Remove this workflow group", () => this.removeGroup(group.id)));
      item.appendChild(secondRow);

      const textArea = this.getGroupTextArea(group, index);
      item.appendChild(textArea);

      // const inputHint = document.createElement("div");
      // inputHint.textContent = `External input: ${getGroupInputName(group.input_slot)} stays bound to this group and overrides this text when connected.`;
      // applyStyles(inputHint, {
      //   marginTop: "4px",
      //   color: "#999",
      //   fontSize: "10px",
      //   lineHeight: "1.3",
      //   wordBreak: "break-word",
      // });
      // item.appendChild(inputHint);

      list.appendChild(item);
      this.groupItemElements.push(item);
    });

    this.root.appendChild(list);
    this.scheduleResizeNode();
  }

  getGroupTextArea(group, index) {
    let entry = this.textWidgets.get(group.id);
    if (!entry) {
      const widgetName = `prompt_group_text_${group.id}`;
      const result = ComfyWidgets.STRING(
        this.node,
        widgetName,
        ["STRING", { default: group.text || "", multiline: true, dynamicPrompts: true }],
        app,
      );
      const widget = result.widget;
      widget.serialize = false;
      widget.hidden = true;
      widget.disabled = true;
      widget.computeSize = () => [0, 0];
      widget.draw = () => {};
      const textArea = widget.inputEl || document.createElement("textarea");
      textArea.dataset.funcodePromptGroup = group.id;
      textArea.addEventListener("input", () => {
        group.text = textArea.value;
        widget.value = textArea.value;
        this.sync();
      });
      const wrapper = document.createElement("div");
      const initialHeight = normalizeTextAreaHeight(group.textarea_height);
      applyStyles(wrapper, {
        width: "100%",
        maxWidth: "100%",
        minWidth: "0",
        height: `${initialHeight + TEXTAREA_BOTTOM_GAP}px`,
        minHeight: `${MIN_TEXTAREA_HEIGHT + TEXTAREA_BOTTOM_GAP}px`,
        position: "relative",
        display: "block",
        boxSizing: "border-box",
        overflow: "visible",
      });
      entry = { widget, textArea, wrapper, group: null, resizeObserver: null };
      entry.resizeObserver = new ResizeObserver(() => {
        const nextHeight = normalizeTextAreaHeight(textArea.offsetHeight || textArea.getBoundingClientRect().height);
        const currentHeight = normalizeTextAreaHeight(entry.group?.textarea_height);
        if (nextHeight === currentHeight) return;
        if (entry.group) entry.group.textarea_height = nextHeight;
        applyStyles(wrapper, {
          height: `${nextHeight + TEXTAREA_BOTTOM_GAP}px`,
          minHeight: `${MIN_TEXTAREA_HEIGHT + TEXTAREA_BOTTOM_GAP}px`,
        });
        textArea.style.height = `${nextHeight}px`;
        this.persistToProperties();
        this.node.setDirtyCanvas(true, true);
        this.scheduleResizeNode();
      });
      entry.resizeObserver.observe(textArea);
      this.textWidgets.set(group.id, entry);
    }
    entry.group = group;
    entry.widget.value = group.text || "";
    entry.textArea.value = group.text || "";
    entry.textArea.placeholder = index === 0 ? "Type prompt text here..." : "";
    const textareaHeight = normalizeTextAreaHeight(group.textarea_height);
    applyStyles(entry.wrapper, {
      height: `${textareaHeight + TEXTAREA_BOTTOM_GAP}px`,
      minHeight: `${MIN_TEXTAREA_HEIGHT + TEXTAREA_BOTTOM_GAP}px`,
    });
    applyStyles(entry.textArea, {
      position: "relative",
      inset: "auto",
      display: "block",
      width: "100%",
      maxWidth: "100%",
      minWidth: "0",
      height: `${textareaHeight}px`,
      minHeight: `${MIN_TEXTAREA_HEIGHT}px`,
      maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
      resize: "vertical",
      padding: "4px",
      border: "1px solid #555",
      borderRadius: "4px",
      background: "#191919",
      color: "#eee",
      boxSizing: "border-box",
      fontSize: "10px",
      lineHeight: "1.4",
      // fontFamily: "Consolas, monospace",
      opacity: "1",
      pointerEvents: "auto",
      transform: "none",
    });
    if (entry.textArea.parentNode !== entry.wrapper) {
      entry.wrapper.innerHTML = "";
      entry.wrapper.appendChild(entry.textArea);
    }
    return entry.wrapper;
  }

  refreshTextAreaLayout() {
    for (const entry of this.textWidgets.values()) {
      const textareaHeight = normalizeTextAreaHeight(entry.group?.textarea_height);
      applyStyles(entry.wrapper, {
        height: `${textareaHeight + TEXTAREA_BOTTOM_GAP}px`,
        minHeight: `${MIN_TEXTAREA_HEIGHT + TEXTAREA_BOTTOM_GAP}px`,
      });
      applyStyles(entry.textArea, {
        position: "relative",
        display: "block",
        width: "100%",
        height: `${textareaHeight}px`,
        minHeight: `${MIN_TEXTAREA_HEIGHT}px`,
        maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
        opacity: "1",
        pointerEvents: "auto",
      });
    }
  }
}

function hideDataWidget(widget) {
  widget.serialize = true;
  widget.hidden = true;
  widget.disabled = true;
  widget.type = "hidden";
  widget.options = widget.options || {};
  widget.options.hidden = true;
  widget.options.serialize = true;
  widget.computeSize = () => [0, 0];
  widget.draw = () => {};
  widget.callback = () => {};
  if (widget.inputEl) widget.inputEl.style.display = "none";
  if (widget.element) widget.element.style.display = "none";
}

function installGraphPromptHook() {
  if (graphPromptHookInstalled) return;
  graphPromptHookInstalled = true;
  const originalGraphToPrompt = app.graphToPrompt;
  app.graphToPrompt = async function () {
    const editors = [];
    for (const node of app.graph?._nodes || []) {
      if (node?.comfyClass !== "PromptGroupsFunCodeNode") continue;
      if (!node.promptGroupsEditor) continue;
      node.promptGroupsEditor.writeWidgetValueForPrompt();
      editors.push(node.promptGroupsEditor);
    }
    try {
      return await originalGraphToPrompt.apply(this, arguments);
    } finally {
      for (const editor of editors) editor.clearWidgetValue();
    }
  };
}

app.registerExtension({
  name: "FunCode.PromptGroupsFunCodeNode",
  async nodeCreated(node) {
    if (node.comfyClass !== "PromptGroupsFunCodeNode") return;
    if (node.promptGroupsEditor) return;
    installGraphPromptHook();
    node.properties = node.properties || {};
    const dataWidget = node.widgets?.find((widget) => widget.name === "groups_json");
    if (!dataWidget) return;
    hideDataWidget(dataWidget);
    const editor = new PromptGroupsEditor(node, dataWidget);
    node.promptGroupsEditor = editor;
    const originalOnConfigure = node.onConfigure;
    node.onConfigure = function (workflowNode) {
      originalOnConfigure?.apply(this, arguments);
      const payload =
        workflowNode?.properties?.prompt_groups_payload ||
        this.properties?.prompt_groups_payload ||
        this.widgets?.find((widget) => widget.name === "groups_json")?.value;
      if (this.promptGroupsEditor && payload) {
        this.promptGroupsEditor.configureFromPayloadValue(payload);
      }
    };
    const originalOnSerialize = node.onSerialize;
    node.onSerialize = function (workflowNode) {
      originalOnSerialize?.apply(this, arguments);
      if (this.promptGroupsEditor) {
        this.promptGroupsEditor.persistToProperties();
        workflowNode.properties = workflowNode.properties || {};
        workflowNode.properties.prompt_groups_payload = this.promptGroupsEditor.serializePayload();
        const groupsWidget = this.widgets?.find((widget) => widget.name === "groups_json");
        if (groupsWidget) groupsWidget.value = this.promptGroupsEditor.serializePayload();
      }
    };
    const domWidget = node.addDOMWidget("prompt_groups_editor", "prompt_groups_editor", editor.root, {
      serialize: false,
    });
    domWidget.serialize = false;
    domWidget.computeSize = () => [
      260,
      Math.max(230, editor.getEditorWidgetHeight()),
    ];
    editor.scheduleResizeNode();
  },
});
