import { app } from "../../scripts/app.js";

const IMAGE_NAMES = ["image", ...Array.from({ length: 9 }, (_, i) => `image_${i + 2}`)];

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
    syncImageInputs(node);
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
        scheduleSync(this);
        return result;
      };
    }
  },
});
