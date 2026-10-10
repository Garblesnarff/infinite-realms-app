/**
 * Simulated Alexa+ web client (#215 step 3b).
 *
 * A real MCP client (`initialize`, `tools/list`, `tools/call` over
 * Streamable HTTP) styled as an Alexa+ conversation. The companion's tools
 * return data; this page writes the short, speakable reply from that data —
 * the same job real Alexa+ would do.
 */

import { McpHttpClient } from './mcp-client.js';

const STEP_DELAY_MS = 700;

const $ = (sel) => document.querySelector(sel);

const state = {
  client: null,
  companionId: null,
  companionName: '',
  running: false,
};

function logCall(tool, args, result) {
  const log = $('#log');
  const entry = document.createElement('div');
  entry.className = 'log-call';
  entry.dataset.tool = tool;
  const req = document.createElement('div');
  req.className = 'log-req';
  req.textContent = `→ ${tool} ${JSON.stringify(args)}`;
  const res = document.createElement('div');
  res.className = 'log-res';
  res.textContent = `← ${summarize(tool, result)}`;
  entry.append(req, res);
  log.append(entry);
  log.scrollTop = log.scrollHeight;
}

function logInfo(text) {
  const log = $('#log');
  const entry = document.createElement('div');
  entry.className = 'log-info';
  entry.textContent = text;
  log.append(entry);
  log.scrollTop = log.scrollHeight;
}

/** One-line human summary of a tool result for the log pane. */
function summarize(tool, result) {
  if (!result) return '(no result)';
  if (result.isError) {
    const text = result.content?.[0]?.text ?? '';
    return `error: ${text.slice(0, 160)}`;
  }
  try {
    const data = JSON.parse(result.content?.[0]?.text ?? '{}');
    switch (tool) {
      case 'join_party':
        return `joined: ${data.companion?.id} (${data.party?.length ?? 0} in party)`;
      case 'list_companions':
        return `${data.companions?.length ?? 0} companion(s)`;
      case 'leave_party':
        return `left: ${data.companion?.id}`;
      case 'get_scene':
        return `scene: ${(data.session?.current_scene_description ?? '').slice(0, 80)}…`;
      case 'speak_as_companion':
        return `said: ${(data.message?.text ?? '').slice(0, 80)}`;
      case 'roll_for_companion':
        return `rolled: d20 ${data.d20} + ${data.modifier} = ${data.total}`;
      default:
        return JSON.stringify(data).slice(0, 120);
    }
  } catch {
    return (result.content?.[0]?.text ?? '').slice(0, 120);
  }
}

/** Show the reply and speak it (browser TTS). Always 1–2 sentences. */
function reply(text) {
  $('#reply').textContent = text;
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  } catch {
    /* headless / no audio: the text is still shown */
  }
}

function toolData(result) {
  if (!result || result.isError) return null;
  try {
    return JSON.parse(result.content?.[0]?.text ?? 'null');
  } catch {
    return null;
  }
}

async function callTool(tool, args) {
  const result = await state.client.callTool(tool, args);
  logCall(tool, args, result);
  return { result, data: toolData(result) };
}

const sessionId = () => $('#session-id').value.trim();
const characterId = () => $('#character-id').value.trim();

function needIds() {
  if (!sessionId() || !characterId()) {
    reply('Enter a session id and a character id first.');
    return true;
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scripted demo: join → scene → speak → roll. */
async function runDemo() {
  if (state.running) return;
  if (needIds()) return;
  state.running = true;
  $('#run-demo').disabled = true;
  try {
    logInfo('— scripted demo started —');

    const joined = await callTool('join_party', {
      session_id: sessionId(),
      character_id: characterId(),
    });
    if (!joined.data) throw new Error('join_party failed');
    state.companionId = joined.data.companion.id;
    state.companionName = joined.data.companion.name ?? 'your companion';
    reply(`${state.companionName} joins your party.`);
    await sleep(STEP_DELAY_MS);

    const scene = await callTool('get_scene', { session_id: sessionId() });
    if (scene.data) {
      const desc = scene.data.session?.current_scene_description ?? '';
      const names = (scene.data.party ?? []).map((m) => m.name).filter(Boolean);
      const firstSentence = desc.split(/(?<=[.!?])\s/)[0] ?? desc;
      reply(
        `${firstSentence} ${names.length ? `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} with you.` : ''}`.trim(),
      );
    }
    await sleep(STEP_DELAY_MS);

    const line = 'Stay behind me. I will check the door for traps.';
    const spoken = await callTool('speak_as_companion', {
      session_id: sessionId(),
      companion_id: state.companionId,
      text: line,
    });
    if (spoken.data) reply(spoken.data.message.text);
    await sleep(STEP_DELAY_MS);

    const roll = await callTool('roll_for_companion', {
      session_id: sessionId(),
      companion_id: state.companionId,
      kind: 'skill',
      name: 'Perception',
      reason: 'checking the door for traps',
    });
    if (roll.data) {
      reply(
        `${state.companionName} rolls Perception: ${roll.data.d20} plus ${roll.data.modifier}, total ${roll.data.total}.`,
      );
    }

    logInfo('— scripted demo complete —');
    const done = document.createElement('div');
    done.dataset.demoDone = 'true';
    done.className = 'log-info';
    done.textContent = 'demo complete';
    $('#log').append(done);
  } catch (error) {
    logInfo(`demo failed: ${error instanceof Error ? error.message : error}`);
    reply('Something went wrong running the demo. Check the tool log.');
  } finally {
    state.running = false;
    $('#run-demo').disabled = false;
  }
}

/** Map free text to the companion tools. */
async function handleInput(text) {
  const lower = text.toLowerCase().trim();
  if (!lower) return;
  logInfo(`you: ${text}`);

  if (/\bjoin\b/.test(lower)) {
    if (needIds()) return;
    const { data } = await callTool('join_party', {
      session_id: sessionId(),
      character_id: characterId(),
    });
    if (data) {
      state.companionId = data.companion.id;
      state.companionName = data.companion.name ?? 'your companion';
      reply(`${state.companionName} joins your party.`);
    } else {
      reply('The join failed. Check the tool log.');
    }
    return;
  }
  if (/\bleave\b/.test(lower)) {
    if (!state.companionId) {
      reply('Nobody has joined yet.');
      return;
    }
    await callTool('leave_party', {
      session_id: sessionId(),
      companion_id: state.companionId,
    });
    reply(`${state.companionName} leaves the party.`);
    state.companionId = null;
    return;
  }
  if (/\b(look|scene|where|around|describe)\b/.test(lower)) {
    if (!sessionId()) {
      reply('Enter a session id first.');
      return;
    }
    const { data } = await callTool('get_scene', { session_id: sessionId() });
    if (data) {
      const desc = data.session?.current_scene_description ?? '';
      reply(desc.split(/(?<=[.!?])\s/)[0] ?? desc);
    } else {
      reply('I could not read the scene. Check the tool log.');
    }
    return;
  }
  const sayMatch = text.match(/\b(?:say|tell (?:me|us|him|her|them)|says?)\b[:\s]+(.+)/i);
  if (sayMatch) {
    if (!state.companionId) {
      reply('Ask your companion to join first.');
      return;
    }
    const { data } = await callTool('speak_as_companion', {
      session_id: sessionId(),
      companion_id: state.companionId,
      text: sayMatch[1].trim(),
    });
    reply(data ? data.message.text : 'The words would not come.');
    return;
  }
  const rollMatch = lower.match(/\broll\b\s*([a-z ]+)?/);
  if (rollMatch) {
    if (!state.companionId) {
      reply('Ask your companion to join first.');
      return;
    }
    const name = (rollMatch[1] ?? 'perception').trim().replace(/\b\w/g, (c) => c.toUpperCase()) || 'Perception';
    const { data } = await callTool('roll_for_companion', {
      session_id: sessionId(),
      companion_id: state.companionId,
      kind: 'skill',
      name: name.slice(0, 64),
    });
    if (data) {
      reply(`${state.companionName} rolls ${name}: total ${data.total}.`);
    } else {
      reply('The roll failed. Check the tool log.');
    }
    return;
  }
  if (/\b(party|companions|who)\b/.test(lower)) {
    if (!sessionId()) {
      reply('Enter a session id first.');
      return;
    }
    const { data } = await callTool('list_companions', { session_id: sessionId() });
    const names = (data?.companions ?? []).map((c) => c.name).filter(Boolean);
    reply(names.length ? `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} with you.` : 'No companions have joined yet.');
    return;
  }
  reply('Try: join, look around, say something, roll perception, who is here, or leave.');
}

function setupMic() {
  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SR) return; // mic button stays hidden
  $('#mic').hidden = false;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.onresult = (event) => {
    const text = event.results[0][0].transcript;
    $('#input').value = text;
    void handleInput(text);
  };
  rec.onerror = () => logInfo('mic: recognition failed');
  $('#mic').addEventListener('click', () => {
    try {
      rec.start();
      logInfo('mic: listening…');
    } catch {
      /* already started */
    }
  });
}

async function main() {
  $('#send').addEventListener('click', () => {
    const text = $('#input').value;
    $('#input').value = '';
    void handleInput(text);
  });
  $('#input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const text = $('#input').value;
      $('#input').value = '';
      void handleInput(text);
    }
  });
  $('#run-demo').addEventListener('click', () => void runDemo());
  setupMic();

  try {
    state.client = new McpHttpClient('/mcp');
    await state.client.connect();
    const tools = await state.client.listTools();
    $('#status').textContent = `connected · ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`;
    $('#status').className = 'ok';
    logInfo(`connected to the companion MCP server (${tools.length} tools)`);
    reply('Connected. Enter a session and character, then run the demo — or just talk to me.');
  } catch (error) {
    $('#status').textContent = `connection failed: ${error instanceof Error ? error.message : error}`;
    $('#status').className = 'bad';
    logInfo('failed to connect to /mcp — is the server running?');
  }
}

void main();
