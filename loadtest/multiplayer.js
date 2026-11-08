import { WebSocket } from 'k6/websockets';
import { setTimeout, clearTimeout } from 'k6/timers';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { cfg, headers, options as makeOptions, warmup } from './common.js';

const sessionFailures = new Rate('room_failures');
const disconnects = new Rate('unexpected_disconnects');
const readyTime = new Trend('room_ready_ms', true);
const rounds = new Counter('rounds_received');
const answers = new Counter('answers_sent');
const replies = new Counter('answer_replies');
const replyTime = new Trend('answer_reply_ms', true);
export const options = makeOptions({
  room_failures: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '90s' }],
  unexpected_disconnects: ['rate<0.01'],
  room_ready_ms: ['p(95)<5000'],
  rounds_received: ['count>0'],
  answers_sent: ['count>0'],
  answer_replies: ['count>0'],
  answer_reply_ms: ['p(95)<1000'],
});
export function setup() { warmup(); }

// One VU owns a room and all its sockets: no coordinator service or shared credentials.
export default function () {
  const sockets = [];
  const timers = [];
  const opened = Date.now();
  let closing = false;
  let failed = false;
  let started = false;
  let joined = 0;
  let assignmentCount = 0;
  let gameSeen = false;
  let roomCode;
  function finish(error = false) {
    if (closing) return;
    failed = failed || error;
    closing = true;
    for (const timer of timers) clearTimeout(timer);
    sessionFailures.add(failed || !gameSeen);
    check(null, { 'room joined and game started': () => !failed && gameSeen });
    for (const socket of sockets) {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
        socket.close();
      } else if (socket.readyState === 0) socket.close();
    }
  }
  function send(socket, message) {
    if (!closing && socket.readyState === 1) socket.send(JSON.stringify(message));
  }
  function connect(index) {
    let answerSentAt = null;
    const socket = new WebSocket(cfg.baseUrl.replace(/^http/, 'ws') + '/ws', [], { headers, tags: { name: 'room_socket' } });
    sockets[index] = socket;
    socket.onopen = () => send(socket, index === 0
      ? { type: 'CREATE_ROOM', playerName: `LT${__VU}-0`, categoryIds: ['flags'], roundLimit: 3, roundDurationMs: 10000 }
      : { type: 'JOIN_ROOM', playerName: `LT${__VU}-${index}`, roomCode });
    socket.onerror = () => finish(true);
    socket.onclose = () => { disconnects.add(!closing); if (!closing) finish(true); };
    socket.onmessage = event => {
      if (closing) return;
      let message;
      try { message = JSON.parse(event.data); } catch { finish(true); return; }
      if (message.type === 'ERROR') { console.error(`Room error: ${message.code}`); finish(true); return; }
      if (message.type === 'SESSION_ASSIGNED') {
        assignmentCount++;
        if (index === 0) {
          roomCode = message.roomCode;
          for (let i = 1; i < cfg.players; i++) connect(i);
        }
      }
      // Each joining socket receives its own snapshot after the assignment.
      if (message.type === 'ROOM_SNAPSHOT') {
        joined = Math.max(joined, message.room.players.filter(player => player.connected).length);
        if (!started && joined === cfg.players && assignmentCount === cfg.players) {
          started = true;
          readyTime.add(Date.now() - opened);
          send(sockets[0], { type: 'START_GAME' });
        }
      }
      if (message.type === 'GAME_STARTED' || message.type === 'ROUND_STARTED') {
        gameSeen = true;
        rounds.add(1);
        timers.push(setTimeout(() => {
          answerSentAt = Date.now();
          send(socket, { type: 'SUBMIT_ANSWER', answer: 'LoadtestGuess', clientSentAt: Date.now() });
          if (!closing) answers.add(1);
        }, 1500 + Math.random() * 2000));
      }
      if ((message.type === 'ANSWER_ACCEPTED' || message.type === 'ANSWER_REJECTED') && answerSentAt !== null) {
        replyTime.add(Date.now() - answerSentAt);
        replies.add(1);
        answerSentAt = null;
      }
      if (index === 0 && message.type === 'GAME_COMPLETED') {
        timers.push(setTimeout(() => send(socket, { type: 'PLAY_AGAIN' }), 3000));
      }
    };
  }
  timers.push(setTimeout(() => { if (!gameSeen) finish(true); }, 15000));
  timers.push(setTimeout(() => finish(), cfg.sessionMs));
  connect(0);
}
