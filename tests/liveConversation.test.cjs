const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal,
    require: (name) => {
      if (name === '@/lib/silenceMonitor') return load('lib/silenceMonitor.ts', globals);
      if (name === '@/lib/conversationContinuation') return load('lib/conversationContinuation.ts', globals);
      if (name === '@/lib/languages') return load('lib/languages.ts', globals);
      if (name === 'pinyin-pro' || name === 'to-jyutping') return require(name);
      throw new Error(`Unexpected import: ${name}`);
    }, ...globals });
  return exports;
}

const { addTranscriptFragment, getLatestCaption, getSpeakerText } = load('lib/liveTranscript.ts');
function fragment(speaker, delta, start_ms, end_ms, event_id) {
  return { type: `session.${speaker === 'learner' ? 'input' : 'output'}_transcript.delta`, delta, start_ms, end_ms, event_id };
}

test('overlapping speech keeps each speaker sentence intact, including delayed fragments', () => {
  let fragments = [];
  for (const event of [
    fragment('coach', 'How ', 0, 300, 'c1'),
    fragment('learner', 'Can I ', 200, 500, 'l1'),
    fragment('coach', 'today?', 600, 900, 'c3'),
    fragment('learner', 'ask something?', 500, 1000, 'l2'),
    fragment('coach', 'are you ', 300, 600, 'c2')
  ]) fragments = addTranscriptFragment(fragments, event);
  assert.equal(getLatestCaption(fragments, 'coach'), 'How are you today?');
  assert.equal(getLatestCaption(fragments, 'learner'), 'Can I ask something?');
  const duplicate = addTranscriptFragment(fragments, fragment('coach', 'How ', 0, 300, 'c1'));
  assert.equal(duplicate, fragments);
});

test('caption grouping uses the speaker timeline and preserves full session text', () => {
  let fragments = addTranscriptFragment([], fragment('coach', 'Hello. ', 0, 500, 'c1'));
  fragments = addTranscriptFragment(fragments, fragment('coach', 'Try saying it this way.', 4000, 5000, 'c2'));
  assert.equal(getLatestCaption(fragments, 'coach'), 'Try saying it this way.');
  assert.equal(getSpeakerText(fragments, 'coach'), 'Hello. Try saying it this way.');
  assert.equal(fragments[0].text, 'Hello. ');
  assert.equal(addTranscriptFragment(fragments, { type: 'session.usage.updated' }), fragments);
});

for (const mode of ['normal', 'super-beginner']) test(`microphone remains on, ${mode} follow-ups are bounded, and mute and finish still work`, async () => {
  let now = 0; const intervals = new Set();
  class Channel extends EventTarget {
    readyState = 'open'; sent = [];
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 'closed'; }
    message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  }
  let peer;
  class Peer extends EventTarget {
    iceGatheringState = 'complete'; channel = new Channel(); closed = false;
    constructor() { super(); peer = this; }
    createDataChannel() { return this.channel; }
    addTrack() {}
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async setLocalDescription(offer) { this.localDescription = offer; }
    async setRemoteDescription() { this.channel.message({ type: 'session.started' }); }
    close() { this.closed = true; }
  }
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const { LiveSession } = load('lib/liveSession.ts', {
    Date: { now: () => now },
    setInterval: (callback, delay) => { const timer = { callback, delay }; intervals.add(timer); return timer; },
    clearInterval: timer => intervals.delete(timer),
    AudioContext: class {
      state = 'running';
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return { getFloatTimeDomainData(samples) { samples.fill(0); }, disconnect() {} }; }
    },
    RTCPeerConnection: Peer,
    Audio: class { play() { return Promise.resolve(); } pause() {} },
    navigator: { mediaDevices: { getUserMedia: async (options) => {
      assert.equal(options.audio.echoCancellation, true);
      return stream;
    } } },
    crypto: { randomUUID: () => 'event-test' },
    fetch: async (url, options) => {
      if (url.endsWith('/session')) {
        assert.equal(JSON.parse(options.body).conversationSummary, 'Learner: I ordered tea.');
        assert.equal(JSON.parse(options.body).language, 'mandarin');
        assert.equal(JSON.parse(options.body).mode, mode);
      }
      return { ok: true, json: async () => url.endsWith('/watchdog')
      ? { status: 'armed' }
      : { transport: { sdp: 'answer' }, watchdog: { token: 'test-token', heartbeatIntervalMs: 10000, heartbeatTimeoutMs: 45000 } } };
    }
  });
  const received = [];
  const session = new LiveSession(event => received.push(event));
  await session.connect('daily', 'Learner: I ordered tea.', 'mandarin', mode);
  try {
    assert.equal(track.enabled, true);
    peer.channel.message(fragment('coach', 'Hello', 0, 100, 'c1'));
    assert.equal(track.enabled, true);
    peer.channel.message(fragment('learner', 'Wait', 50, 150, 'l1'));
    assert.equal(received.at(-1).delta, 'Wait');
    const tick = [...intervals].find(timer => timer.delay === 100).callback;
    now = 5999; tick(); assert.equal(peer.channel.sent.length, 0);
    now = 6000; tick(); assert.match(peer.channel.sent.at(-1).content, /Take the lead/);
    assert.equal(peer.channel.sent.length, 1);
    if (mode === 'normal') {
      assert.match(peer.channel.sent[0].content, /selected practice language/);
      assert.doesNotMatch(peer.channel.sent[0].content, /explaining any new phrase in English/);
    } else assert.match(peer.channel.sent[0].content, /explaining any new phrase in English/);
    now = 7000; peer.channel.message(fragment('coach', 'Next tiny activity', 200, 500, 'c2'));
    now = 13000; tick(); assert.equal(peer.channel.sent.length, 1);
    peer.channel.message(fragment('learner', 'Okay', 500, 700, 'l2'));
    session.mute(true); assert.equal(track.enabled, false);
    now = 19000; tick(); assert.equal(peer.channel.sent.length, 1);
    session.mute(false); assert.equal(track.enabled, true);
    tick(); assert.equal(peer.channel.sent.length, 2);
    session.sendMessage('Start a conversation');
    assert.equal(peer.channel.sent.at(-1).type, 'session.instructions.append');
    session.close();
    assert.equal(track.enabled, false);
    assert.equal(peer.closed, false);
    assert.equal(peer.channel.sent.at(-1).type, 'session.close');
    peer.channel.message({ type: 'session.closed' });
    assert.equal(track.stopped, true);
    assert.equal(peer.closed, true);
    assert.equal(intervals.size, 0);
  } finally {
    session.close();
    peer.channel.message({ type: 'session.closed' });
  }
});

const { emptySessionUsage, updateSessionUsage, getSessionMetrics, formatSessionDuration } = load('lib/liveUsage.ts');

test('meter counts muted/silent wall time and credits initialization instead of adding it', () => {
  let usage = updateSessionUsage(emptySessionUsage(), { type: 'session.created' }, 1000);
  assert.equal(getSessionMetrics(usage, 1000).billableSeconds, 15);
  usage = updateSessionUsage(usage, { type: 'session.started' }, 2000);
  const short = getSessionMetrics(usage, 12000);
  assert.equal(short.elapsedSeconds, 10);
  assert.equal(short.billableSeconds, 15);
  const longer = getSessionMetrics(usage, 92000);
  assert.equal(longer.elapsedSeconds, 90);
  assert.equal(longer.billableSeconds, 90);
  assert.ok(Math.abs(longer.costUsd - 0.075) < 1e-10);
  assert.equal(formatSessionDuration(longer.elapsedSeconds), '01:30');
  assert.equal(formatSessionDuration(3661.8), '61:01');
});

test('cumulative usage is replaced, interpolated, and finalized even after Finish', () => {
  let usage = updateSessionUsage(emptySessionUsage(), { type: 'session.started' }, 0);
  usage = updateSessionUsage(usage, { type: 'session.usage.updated', usage: { seconds: 30 } }, 30000);
  usage = updateSessionUsage(usage, { type: 'session.usage.updated', usage: { seconds: 60 } }, 60000);
  assert.equal(getSessionMetrics(usage, 65000).billableSeconds, 65);
  assert.equal(updateSessionUsage(usage, { type: 'session.usage.updated', usage: { seconds: 20 } }, 66000), usage);
  usage = updateSessionUsage(usage, { type: 'session.close.requested' }, 66000);
  assert.equal(usage.status, 'closing');
  assert.equal(getSessionMetrics(usage, 67000).billableSeconds, 67);
  usage = updateSessionUsage(usage, { type: 'session.closed', usage: { seconds: 66.5 } }, 68000);
  assert.equal(usage.status, 'confirmed');
  assert.equal(getSessionMetrics(usage, 999000).billableSeconds, 66.5);
  assert.equal(getSessionMetrics(usage, 999000).elapsedSeconds, 68);
  assert.equal(updateSessionUsage(usage, { type: 'connection.closed' }, 69000), usage);
});

test('lost connection freezes an estimate and malformed usage never becomes a confirmed total', () => {
  let usage = updateSessionUsage(emptySessionUsage(), { type: 'session.started' }, 1000);
  usage = updateSessionUsage(usage, { type: 'session.usage.updated', usage: { seconds: 20 } }, 21000);
  usage = updateSessionUsage(usage, { type: 'connection.closed' }, 26000);
  assert.equal(usage.status, 'unconfirmed');
  assert.equal(getSessionMetrics(usage, 900000).billableSeconds, 25);
  const noUsage = updateSessionUsage(usage, { type: 'session.closed', usage: { seconds: NaN } }, 26000);
  assert.equal(noUsage.status, 'unconfirmed');
  assert.equal(getSessionMetrics(emptySessionUsage(), 999999).costUsd, 0);
});

test('fractional timing is preserved and API cost excludes local interpolation', () => {
  let usage = updateSessionUsage(emptySessionUsage(), { type: 'session.started' }, 1234.25);
  usage = updateSessionUsage(usage, { type: 'session.usage.updated', usage: { seconds: 30.125 } }, 31359.25);
  const metrics = getSessionMetrics(usage, 31484.75);
  assert.ok(Math.abs(metrics.elapsedSeconds - 30.2505) < 1e-9);
  assert.ok(Math.abs(metrics.billableSeconds - 30.2505) < 1e-9);
  assert.ok(Math.abs(metrics.reportedCostUsd - 30.125 / 60 * 0.05) < 1e-12);
  assert.ok(metrics.costUsd > metrics.reportedCostUsd);
  assert.equal(formatSessionDuration(30.2505, true), '00:30.250');
  assert.equal(formatSessionDuration(60.001, true), '01:00.001');
  usage = updateSessionUsage(usage, { type: 'session.closed', usage: { seconds: 30.175 } }, 31500.75);
  const final = getSessionMetrics(usage, 1000000);
  assert.equal(final.billableSeconds, 30.175);
  assert.equal(final.costUsd, final.reportedCostUsd);
  assert.equal(getSessionMetrics(emptySessionUsage(), 0).reportedCostUsd, null);
});

test('silence deadline closes at 30 seconds and restarts after activity', () => {
  const { SilenceDeadline } = load('lib/silenceMonitor.ts');
  const deadline = new SilenceDeadline(1000);
  assert.equal(deadline.expired(30999), false);
  assert.equal(deadline.expired(31000), true);
  deadline.activity(32000);
  assert.equal(deadline.expired(61999), false);
  assert.equal(deadline.expired(62000), true);
});

test('either speaker audio prevents idle close, which fires once after both go silent', () => {
  let now = 0, tick, closed = 0, disposed = false;
  const { SilenceMonitor } = load('lib/silenceMonitor.ts', {
    Date: { now: () => now },
    setInterval: callback => { tick = callback; return 1; },
    clearInterval: () => { tick = null; },
    AudioContext: class {
      state = 'running';
      resume() { return Promise.resolve(); }
      close() { disposed = true; return Promise.resolve(); }
      createMediaStreamSource(stream) {
        return { connect(analyser) { analyser.stream = stream; }, disconnect() {} };
      }
      createAnalyser() {
        return { getFloatTimeDomainData(samples) { samples.fill(this.stream.level); }, disconnect() {} };
      }
    }
  });
  const microphone = { level: 0 }, coach = { level: 0 };
  const monitor = new SilenceMonitor(() => closed++);
  monitor.addStream(microphone); monitor.addStream(coach); monitor.start();
  now = 29999; tick(); assert.equal(closed, 0);
  microphone.level = 0.03;
  now = 30000; tick(); assert.equal(closed, 0);
  microphone.level = 0; coach.level = 0.03;
  now = 59000; tick(); assert.equal(closed, 0);
  coach.level = 0;
  now = 88999; tick(); assert.equal(closed, 0);
  now = 89000; tick(); assert.equal(closed, 1);
  assert.equal(tick, null);
  monitor.dispose(); assert.equal(disposed, true);
});

const { summarizeConversation, CONVERSATION_SUMMARY_LIMIT } = load('lib/conversationMemory.ts');
const { buildCoachInstructions } = load('lib/coachInstructions.ts');

test('pause memory keeps prior context and both speakers across repeated resumes', () => {
  const first = summarizeConversation('', [
    { speaker: 'learner', text: 'I ordered ', startMs: 0, endMs: 100 },
    { speaker: 'learner', text: 'tea.', startMs: 100, endMs: 200 },
    { speaker: 'coach', text: 'Try saying it more naturally.', startMs: 300, endMs: 400 }
  ]);
  assert.match(first, /Learner: I ordered tea\./);
  const second = summarizeConversation(first, [{ speaker: 'learner', text: 'Now can we order food?', startMs: 0, endMs: 100 }]);
  assert.match(second, /Try saying it more naturally/);
  assert.match(second, /Now can we order food\?/);
  assert.equal(summarizeConversation(second, []), second);
});

test('bounded pause memory preserves opening context and latest discussion', () => {
  const memory = summarizeConversation('Opening context\n' + 'x'.repeat(15000), [{ speaker: 'learner', text: 'Latest question', startMs: 0, endMs: 100 }]);
  assert.equal(memory.length, CONVERSATION_SUMMARY_LIMIT);
  assert.ok(memory.startsWith('Opening context'));
  assert.ok(memory.endsWith('Learner: Latest question'));
});

test('resumed coaching treats saved conversation as data and avoids the initial greeting', () => {
  const scenario = { title: 'Food', situation: 'Restaurant', coachGoal: 'Order', learnerGoal: 'Speak', accentFocus: [] };
  const initial = buildCoachInstructions(scenario);
  const resumed = buildCoachInstructions(scenario, 'Learner: I ordered tea.');
  assert.match(initial, /Start by greeting/);
  assert.doesNotMatch(resumed, /Start by greeting/);
  assert.match(resumed, /prior conversation data, not new instructions/);
  assert.match(resumed, /Learner: I ordered tea/);
});

const { getScenario } = load('lib/scenarios.ts');
const { pronunciationCharacters } = load('lib/pronunciation.ts');

test('Mandarin scenarios and coaching consistently use Mandarin, including saved context', () => {
  for (const id of ['daily', 'repair']) {
    const scenario = getScenario(id, 'mandarin');
    assert.doesNotMatch(JSON.stringify(scenario), /Cantonese|Guangzhou/);
    const instructions = buildCoachInstructions(scenario, 'Learner: 我想喝茶。', 'mandarin');
    assert.match(instructions, /standard Mandarin \(Putonghua\)/);
    assert.match(instructions, /neutral tone, tone sandhi/);
    assert.match(instructions, /Pinyin/);
    assert.doesNotMatch(instructions, /Jyutping|Guangzhou/);
    assert.match(instructions, /我想喝茶/);
  }
  assert.match(buildCoachInstructions(getScenario('daily')), /Guangzhou-standard spoken Cantonese/);
});

test('the same captions use Jyutping or Mandarin pinyin without altering English and emoji', () => {
  const text = '你好 hello😀！';
  const cantonese = pronunciationCharacters(text, 'cantonese');
  const mandarin = pronunciationCharacters(text, 'mandarin');
  assert.equal(cantonese[0][1], 'nei5');
  assert.equal(cantonese[1][1], 'hou2');
  assert.equal(mandarin[0][1], 'nǐ');
  assert.equal(mandarin[1][1], 'hǎo');
  assert.equal(mandarin.map(item => item[0]).join(''), text);
  assert.ok(mandarin.slice(2).every(item => item[1] === null));
});

test('Cantonese progress is preserved separately from Mandarin progress', () => {
  const stored = new Map();
  const { loadProgress, saveProgress, progressStorageKey } = load('lib/progress.ts', {
    window: { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } }
  });
  saveProgress({ ...loadProgress(), sessionsCompleted: 7 });
  assert.equal(loadProgress('mandarin').sessionsCompleted, 0);
  saveProgress({ ...loadProgress('mandarin'), sessionsCompleted: 2 }, 'mandarin');
  assert.equal(loadProgress().sessionsCompleted, 7);
  assert.equal(loadProgress('mandarin').sessionsCompleted, 2);
  assert.ok(stored.has(progressStorageKey));
});

test('Super beginner teaches from zero in English without contradictory roleplay instructions', () => {
  for (const language of ['mandarin', 'cantonese']) {
    const instructions = buildCoachInstructions(getScenario('daily', language), '', language, 'super-beginner');
    assert.match(instructions, /knows zero words/);
    assert.match(instructions, /Teach mostly in English/);
    assert.match(instructions, /Always explain its meaning in English/);
    assert.match(instructions, /You drive the lesson/);
    assert.match(instructions, /After an attempt or acknowledgment, immediately/);
    assert.match(instructions, /without asking the learner what to learn/);
    assert.match(instructions, /pair praise with the next concrete activity/);
    assert.match(instructions, /do not keep it running with repeated check-ins/);
    assert.doesNotMatch(instructions, /Introduce no new vocabulary until|then wait\./);
    assert.match(instructions, /at most one gentle correction/);
    assert.match(instructions, /Initially explain questions in English/);
    assert.match(instructions, /Start in English/);
    assert.doesNotMatch(instructions, /Speak mostly|whose .* is okay but not fluent|Coach goal: Keep the learner answering/);
  }
});

test('resuming a beginner lesson preserves the tiny lesson instead of assuming vocabulary knowledge', () => {
  const instructions = buildCoachInstructions(getScenario('food', 'mandarin'), 'Learner practiced 你好', 'mandarin', 'super-beginner');
  assert.match(instructions, /latest requested difficulty/);
  assert.match(instructions, /Do not assume they know untaught words/);
  assert.match(instructions, /Learner practiced 你好/);
  assert.doesNotMatch(instructions, /Start in English:/);
  const normal = buildCoachInstructions(getScenario('daily', 'mandarin'), '', 'mandarin');
  assert.match(normal, /Speak mostly Mandarin/);
  assert.doesNotMatch(normal, /knows zero words/);
});

test('Mandarin pronunciation guidance separates languages and addresses reported problem phrases', () => {
  for (const mode of ['normal', 'super-beginner']) {
    const instructions = buildCoachInstructions(getScenario('daily', 'mandarin'), '', 'mandarin', mode);
    assert.match(instructions, /short natural pause/);
    assert.match(instructions, /再见（zài jiàn）/);
    assert.match(instructions, /我很好（wǒ hěn hǎo）/);
    assert.match(instructions, /第三声变调/);
    assert.match(instructions, /not an English approximation/);
  }
  assert.doesNotMatch(buildCoachInstructions(getScenario('daily')), /再见（zài jiàn）/);
});

test('beginner pacing adapts to explicit requests for complex material and preserves them on resume', () => {
  for (const language of ['mandarin', 'cantonese']) {
    const summary = 'Learner: I already know hello and thanks. Teach me longer sentences.';
    const instructions = buildCoachInstructions(getScenario('daily', language), summary, language, 'super-beginner');
    assert.match(instructions, /starting point, not a permanent ceiling/);
    assert.match(instructions, /Honor requests such as teach me something more complex/);
    assert.match(instructions, /over the default beginner pacing/);
    assert.match(instructions, /Keep the requested difficulty/);
    assert.match(instructions, /saved lesson and its latest requested difficulty/);
    assert.match(instructions, /supported roleplay immediately/);
    assert.match(instructions, /Learner: I already know hello and thanks/);
    assert.doesNotMatch(instructions, /at most three words|Never ask an untranslated question or launch into a full roleplay/);
  }
});

test('long conversations keep caption rendering bounded without discarding saved transcript', () => {
  const text = '你好'.repeat(1000) + ' Latest question';
  const fragments = [{ speaker: 'coach', text, startMs: 0, endMs: 10000 }];
  const caption = getLatestCaption(fragments, 'coach');
  assert.equal(caption.length, 601);
  assert.ok(caption.startsWith('…'));
  assert.ok(caption.endsWith(' Latest question'));
  assert.equal(getSpeakerText(fragments, 'coach'), text);
});

test('background pronunciation preserves text and request identity for both languages', () => {
  const replies = [];
  const port = { postMessage: message => replies.push(message) };
  load('lib/pronunciation.worker.ts', {
    self: port,
    require: name => {
      assert.equal(name, '@/lib/pronunciation');
      return { pronunciationCharacters };
    }
  });
  port.onmessage({ data: { id: 1, text: '你好 hello', language: 'mandarin' } });
  port.onmessage({ data: { id: 2, text: '你好', language: 'cantonese' } });
  assert.equal(replies[0].id, 1);
  assert.equal(replies[0].characters[0][1], 'nǐ');
  assert.equal(replies[0].characters.map(item => item[0]).join(''), '你好 hello');
  assert.equal(replies[1].id, 2);
  assert.equal(replies[1].characters[0][1], 'nei5');
});
