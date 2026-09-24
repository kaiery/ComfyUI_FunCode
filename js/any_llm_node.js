import { app } from "../../scripts/app.js";

const IMAGE_NAMES = ["image", ...Array.from({ length: 9 }, (_, i) => `image_${i + 2}`)];
const PROMPT_NAMES = ["system_prompt", "user_prompt"];
const LAYOUT_PROPERTY = "funcode_prompt_layout";
const MIN_PROMPT_HEIGHT = 60;
const DEFAULT_PROMPT_HEIGHT = 120;
const layouts = new WeakMap();

function validSize(size) {
  return size && [size[0], size[1]].every((value) => Number.isFinite(value) && value > 0);
}

function promptHeight(node, name) {
  const layout = layouts.get(node);
  // Use graph coordinates, never DOM bounds (which include canvas zoom).
  const delta = (node.size[1] - layout.size[1]) / PROMPT_NAMES.length;
  return Math.max(MIN_PROMPT_HEIGHT, layout.heights[name] + delta);
}

function installPromptLayout(node, saved) {
  const size = validSize(saved?.size) ? [...saved.size] : [...node.size];
  const heights = {};
  for (const name of PROMPT_NAMES) {
    const height = saved?.heights?.[name];
    heights[name] = Number.isFinite(height) && height >= MIN_PROMPT_HEIGHT ? height : DEFAULT_PROMPT_HEIGHT;
    const widget = node.widgets?.find((item) => item.name === name);
    if (!widget) continue;
    widget.options ||= {};
    widget.options.getMinHeight = () => MIN_PROMPT_HEIGHT;
    widget.options.getMaxHeight = () => promptHeight(node, name);
    widget.options.getHeight = () => promptHeight(node, name);
    const element = widget.element ?? widget.inputEl;
    if (element?.style) element.style.resize = "none";
  }
  layouts.set(node, { size, heights });
}

function savePromptLayout(node, data) {
  if (!layouts.has(node)) installPromptLayout(node);
  const heights = {};
  for (const name of PROMPT_NAMES) {
    const widget = node.widgets?.find((item) => item.name === name);
    const measured = widget?.computedHeight;
    heights[name] = Number.isFinite(measured) && measured >= MIN_PROMPT_HEIGHT
      ? measured : promptHeight(node, name);
  }
  const saved = { size: [...node.size], heights };
  node.properties ||= {};
  node.properties[LAYOUT_PROPERTY] = saved;
  data.properties ||= {};
  data.properties[LAYOUT_PROPERTY] = structuredClone(saved);
}

function syncImageInputs(node) {
  // Keep connected slots at their original names and retain one trailing spare.
  let lastConnected = -1;
  for (const input of node.inputs || []) {
    const index = IMAGE_NAMES.indexOf(input.name);
    if (index >= 0 && input.link != null) lastConnected = Math.max(lastConnected, index);
  }
  const count = Math.min(IMAGE_NAMES.length, lastConnected + 2);
  for (let i = (node.inputs?.length || 0) - 1; i >= 0; i--) {
    const input = node.inputs[i];
    if (IMAGE_NAMES.indexOf(input.name) >= count && input.link == null) node.removeInput(i);
  }
  for (const name of IMAGE_NAMES.slice(0, count)) {
    if (!node.inputs?.some((input) => input.name === name)) node.addInput(name, "IMAGE");
  }
  node.setDirtyCanvas(true, true);
}

function scheduleSync(node) {
  if (node._funCodeImageSyncPending) return;
  node._funCodeImageSyncPending = true;
  // Let workflow restoration and connection callbacks finish before editing slots.
  queueMicrotask(() => {
    node._funCodeImageSyncPending = false;
    if (!layouts.has(node)) installPromptLayout(node);
    const size = node._funCodeRestoreSize ?? [...node.size];
    delete node._funCodeRestoreSize;
    syncImageInputs(node);
    // Slot edits can auto-resize the node. Restore the saved/user size after
    // removing spare inputs, growing only when the remaining controls require it.
    const minimum = node.computeSize();
    const nextSize = [Math.max(size[0], minimum[0]), Math.max(size[1], minimum[1])];
    const layout = layouts.get(node);
    layout.size[1] += nextSize[1] - size[1];
    node.setSize(nextSize);
  });
}

app.registerExtension({
  name: "FunCode.AnyLLM.DynamicImages",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "AnyLLMFunCodeNode") return;
    for (const hook of ["onNodeCreated", "onConfigure", "onConnectionsChange"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function (...args) {
        const result = original?.apply(this, args);
        if (hook === "onConfigure") {
          const data = args[0];
          installPromptLayout(this, data?.properties?.[LAYOUT_PROPERTY] ?? { size: data?.size });
          if (validSize(data?.size)) this._funCodeRestoreSize = [data.size[0], data.size[1]];
        }
        scheduleSync(this);
        return result;
      };
    }
    const originalSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (data) {
      originalSerialize?.call(this, data);
      savePromptLayout(this, data);
    };
  },
});
