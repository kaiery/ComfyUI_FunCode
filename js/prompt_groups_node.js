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

async function fetchPresets() {
  const response = await api.fetchApi("/funcode/prompt_group_presets");
  const data = await response.json();
  return Array.isArray(data?.presets) ? data.presets : [];
}

async function savePreset(name, text) {
  const response = await api.fetchApi("/funcode/prompt_group_presets/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  const data = await response.json();
  if (!response.ok || data?.status === "error") {
    throw new Error(data?.message || "Failed to save preset.");
  }
  return Array.isArray(data?.presets) ? data.presets : [];
}

async function deletePreset(name) {
  const response = await api.fetchApi("/funcode/prompt_group_presets/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json();
  if (!response.ok || data?.status === "error") {
    throw new Error(data?.message || "Failed to delete preset.");
  }
  return Array.isArray(data?.presets) ? data.presets : [];
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
    minHeight: "24px",
    padding: "3px 8px",
    border: "1px solid #555",
    borderRadius: "4px",
    background: "#2b2b2b",
    color: "#ddd",
    cursor: "pointer",
    fontSize: "11px",
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
    height: "24px",
    padding: "3px 6px",
    border: "1px solid #555",
    borderRadius: "4px",
    background: "#1f1f1f",
    color: "#ddd",
    boxSizing: "border-box",
    fontSize: "12px",
  });
  return input;
}

function createSelect(title) {
  const select = document.createElement("select");
  select.title = title || "";
  applyStyles(select, {
    minWidth: "0",
    height: "24px",
    padding: "2px 6px",
    border: "1px solid #555",
    borderRadius: "4px",
    background: "#1f1f1f",
    color: "#ddd",
    boxSizing: "border-box",
    fontSize: "12px",
  });
  return select;
}

class PromptGroupsEditor {
  constructor(node, dataWidget) {
    this.node = node;
    this.dataWidget = dataWidget;
    this.payload = parsePayload(node.properties?.prompt_groups_payload || dataWidget.value);
    this.presets = [];
    this.transientPresetTargets = new Map();
    this.textWidgets = new Map();
    this.root = document.createElement("div");
    this.root.className = "funcode-prompt-groups";
    applyStyles(this.root, {
      width: "100%",
      maxWidth: "100%",
      minWidth: "0",
      boxSizing: "border-box",
      padding: "6px",
      color: "#ddd",
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      overflow: "visible",
      paddingBottom: "8px",
    });
    this.persistToProperties();
    this.clearWidgetValue();
    this.render();
    this.loadPresets();
  }

  async loadPresets() {
    try {
      this.presets = await fetchPresets();
      this.render();
    } catch (error) {
      console.error("[FunCode] Failed to load prompt group presets.", error);
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
    return 64 + this.payload.groups.length * 198;
  }

  getNodeHeight() {
    return 88 + this.payload.groups.length * 206;
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
    const height = Math.max(this.getNodeHeight(), 280);
    const width = this.node.size?.[0] || 420;
    if (this.node.setSize) this.node.setSize([width, height]);
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
    requestAnimationFrame(() => {
      this.refreshTextAreaLayout();
      this.resizeNode();
    });
  }

  removeTextWidget(groupId) {
    const entry = this.textWidgets.get(groupId);
    if (!entry) return;
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
    return this.presets.find((preset) => preset.name === name);
  }

  loadPresetIntoGroup(group, name) {
    const presetName = String(name || "").trim();
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
    if (!name) {
      this.transientPresetTargets.delete(group.id);
      return;
    }
    this.transientPresetTargets.set(group.id, name);
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
      this.presets = await savePreset(name, group.text || "");
      this.setPresetTarget(group, name);
      this.render();
    } catch (error) {
      alert(error.message || "Failed to save preset.");
    }
  }

  async saveAsPreset(group) {
    const suggestedName = this.getPresetTarget(group) || "";
    const rawName = prompt("Save as preset name:", suggestedName);
    if (rawName === null) return;
    const name = String(rawName || "").trim();
    if (!name) {
      alert("Preset name is required.");
      return;
    }
    if (this.findPreset(name) && !confirm(`Preset "${name}" already exists. Overwrite it?`)) return;
    try {
      this.presets = await savePreset(name, group.text || "");
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
      this.presets = await deletePreset(name);
      this.setPresetTarget(group, "");
      this.render();
    } catch (error) {
      alert(error.message || "Failed to delete preset.");
    }
  }

  renderPresetOptions(select, selectedName = "") {
    select.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Load preset...";
    select.appendChild(emptyOption);
    for (const preset of this.presets) {
      const option = document.createElement("option");
      option.value = preset.name;
      option.textContent = preset.name;
      select.appendChild(option);
    }
    select.value = this.findPreset(selectedName) ? selectedName : "";
  }

  render() {
    this.root.innerHTML = "";
    this.syncExternalInputs();
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
    toolbar.appendChild(createButton("Refresh", "Refresh local presets", () => this.loadPresets()));
    this.root.appendChild(toolbar);

    const list = document.createElement("div");
    applyStyles(list, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      minWidth: "0",
      maxWidth: "100%",
      paddingBottom: "6px",
    });

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

      const presetSelect = createSelect("Load local preset into this group");
      applyStyles(presetSelect, {
        flex: "1 1 150px",
        maxWidth: "100%",
      });
      this.renderPresetOptions(presetSelect, this.getPresetTarget(group));
      presetSelect.onchange = () => {
        if (!presetSelect.value) {
          this.setPresetTarget(group, "");
          this.render();
          return;
        }
        this.loadPresetIntoGroup(group, presetSelect.value);
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

      const inputHint = document.createElement("div");
      inputHint.textContent = `External input: ${getGroupInputName(group.input_slot)} stays bound to this group and overrides this text when connected.`;
      applyStyles(inputHint, {
        marginTop: "4px",
        color: "#999",
        fontSize: "10px",
        lineHeight: "1.3",
        wordBreak: "break-word",
      });
      item.appendChild(inputHint);

      list.appendChild(item);
    });

    this.root.appendChild(list);
    requestAnimationFrame(() => {
      this.refreshTextAreaLayout();
      this.resizeNode();
    });
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
      applyStyles(wrapper, {
        width: "100%",
        maxWidth: "100%",
        minWidth: "0",
        height: "96px",
        minHeight: "96px",
        position: "relative",
        display: "block",
        boxSizing: "border-box",
        overflow: "visible",
      });
      entry = { widget, textArea, wrapper };
      this.textWidgets.set(group.id, entry);
    }
    entry.widget.value = group.text || "";
    entry.textArea.value = group.text || "";
    entry.textArea.placeholder = index === 0 ? "Type prompt text here..." : "";
    applyStyles(entry.textArea, {
      position: "absolute",
      inset: "auto",
      display: "block",
      width: "100%",
      maxWidth: "100%",
      minWidth: "0",
      height: "100%",
      minHeight: "100%",
      top: "0",
      left: "0",
      resize: "vertical",
      padding: "8px",
      border: "1px solid #555",
      borderRadius: "4px",
      background: "#191919",
      color: "#eee",
      boxSizing: "border-box",
      fontSize: "12px",
      lineHeight: "1.4",
      fontFamily: "Consolas, monospace",
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
      applyStyles(entry.wrapper, {
        height: "96px",
        minHeight: "96px",
      });
      applyStyles(entry.textArea, {
        position: "absolute",
        display: "block",
        width: "100%",
        height: "100%",
        minHeight: "100%",
        top: "0",
        left: "0",
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
    requestAnimationFrame(() => editor.resizeNode());
  },
});
