// @ts-nocheck -- this file runs in an AudioWorklet, whose globals the page's type check does not know.
//
// Hands the microphone's samples to the page, block by block (ENG-V3-02, stage A).
// The node is created with one mono input, so `inputs[0][0]` is the whole signal.
// It writes no output: nothing is played back. It keeps nothing and sends nothing
// anywhere but to the page that created it.
class PcmCollector extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples?.length) this.port.postMessage(samples.slice(0));
    return true;
  }
}

registerProcessor('pcm-collector', PcmCollector);
