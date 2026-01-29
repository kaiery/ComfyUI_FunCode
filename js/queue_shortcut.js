import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

class EventManager {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  removeEventListener(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  dispatchEvent(event, detail = {}) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      callbacks.forEach(callback => {
        try {
          callback({ detail });
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }
}

class QueueManager {
  constructor() {
    this.eventManager = new EventManager();
    this.queueNodeIds = null;
    this.processingQueue = false;
    this.lastAdjustedMouseEvent = null;
    this.isLGTriggered = false; // Flag for LG extension trigger
    this.initializeHooks();
  }

  initializeHooks() {
    const originalQueuePrompt = app.queuePrompt;
    const originalGraphToPrompt = app.graphToPrompt;
    const originalApiQueuePrompt = api.queuePrompt;

    app.queuePrompt = async function() {
      this.processingQueue = true;
      this.eventManager.dispatchEvent("queue");
      try {
        await originalQueuePrompt.apply(app, [...arguments]);
      } finally {
        this.processingQueue = false;
        this.eventManager.dispatchEvent("queue-end");
      }
    }.bind(this);

    app.graphToPrompt = async function() {
      this.eventManager.dispatchEvent("graph-to-prompt");
      let promise = originalGraphToPrompt.apply(app, [...arguments]);
      await promise;
      this.eventManager.dispatchEvent("graph-to-prompt-end");
      return promise;
    }.bind(this);

    api.queuePrompt = async function(index, prompt, ...args) {
      // Only modify prompt.output if triggered by our extension
      if (this.isLGTriggered && this.queueNodeIds && this.queueNodeIds.length && prompt.output) {
        const oldOutput = prompt.output;
        let newOutput = {};
        for (const queueNodeId of this.queueNodeIds) {
          this.recursiveAddNodes(String(queueNodeId), oldOutput, newOutput);
        }
        prompt.output = newOutput;
      }
      
      this.eventManager.dispatchEvent("comfy-api-queue-prompt-before", {
        workflow: prompt.workflow,
        output: prompt.output,
      });
      
      const response = originalApiQueuePrompt.apply(api, [index, prompt, ...args]);
      this.eventManager.dispatchEvent("comfy-api-queue-prompt-end");
      return response;
    }.bind(this);

    const originalProcessMouseDown = LGraphCanvas.prototype.processMouseDown;
    const originalAdjustMouseEvent = LGraphCanvas.prototype.adjustMouseEvent;
    const originalProcessMouseMove = LGraphCanvas.prototype.processMouseMove;

    LGraphCanvas.prototype.processMouseDown = function(e) {
      const result = originalProcessMouseDown.apply(this, [...arguments]);
      queueManager.lastAdjustedMouseEvent = e;
      return result;
    };

    LGraphCanvas.prototype.adjustMouseEvent = function(e) {
      originalAdjustMouseEvent.apply(this, [...arguments]);
      queueManager.lastAdjustedMouseEvent = e;
    };

    LGraphCanvas.prototype.processMouseMove = function(e) {
      const result = originalProcessMouseMove.apply(this, [...arguments]);
      if (e && !e.canvasX && !e.canvasY) {
        const canvas = app.canvas;
        const offset = canvas.convertEventToCanvasOffset(e);
        e.canvasX = offset[0];
        e.canvasY = offset[1];
      }
      queueManager.lastAdjustedMouseEvent = e;
      return result;
    };
  }
  recursiveAddNodes(nodeId, oldOutput, newOutput) {
    let currentId = nodeId;
    let currentNode = oldOutput[currentId];
    if (newOutput[currentId] == null) {
      newOutput[currentId] = currentNode;
      for (const inputValue of Object.values(currentNode.inputs || [])) {
        if (Array.isArray(inputValue)) {
          this.recursiveAddNodes(inputValue[0], oldOutput, newOutput);
        }
      }
    }
    return newOutput;
  }
  async queueOutputNodes(nodeIds) {
    try {
      this.queueNodeIds = nodeIds;
      this.isLGTriggered = true; 
      await app.queuePrompt();
    } catch (e) {
      console.error("Error queueing nodes:", e);
    } finally {
      this.queueNodeIds = null;
      this.isLGTriggered = false; 
    }
  }
  getLastMouseEvent() {
    return this.lastAdjustedMouseEvent;
  }
  addEventListener(event, callback) {
    this.eventManager.addEventListener(event, callback);
  }
  removeEventListener(event, callback) {
    this.eventManager.removeEventListener(event, callback);
  }
}

function getOutputNodes(nodes) {
  return (nodes?.filter((n) => {
    return (n.mode != LiteGraph.NEVER &&
      n.constructor.nodeData?.output_node);
  }) || []);
}
const queueManager = new QueueManager();

export { queueManager, getOutputNodes };
