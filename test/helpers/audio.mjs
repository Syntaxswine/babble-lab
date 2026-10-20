export class AudioParam {
  constructor(value = 1) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.events.push(['set', value, time]); this.value = value; }
  linearRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); this.value = value; }
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
}
class Node {
  connect(other) { this.output = other; }
  disconnect() { this.disconnected = true; }
}
export class AudioContext {
  constructor() { this.currentTime = 10; this.destination = {}; this.sources = []; this.gains = []; }
  createGain() { const node = new Node(); node.gain = new AudioParam(); this.gains.push(node); return node; }
  createBuffer(channels, length, sampleRate) {
    const samples = new Float32Array(length);
    return { duration: length / sampleRate, length, sampleRate, samples,
      copyToChannel(values, channel, offset) { samples.set(values, offset); } };
  }
  createBufferSource() {
    const node = new Node(); node.playbackRate = new AudioParam();
    node.starts = []; node.stops = [];
    node.start = (...args) => node.starts.push(args);
    node.stop = (...args) => node.stops.push(args);
    this.sources.push(node); return node;
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}
