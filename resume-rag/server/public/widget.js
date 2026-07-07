(function () {
  const API_URL = document.currentScript?.dataset?.apiUrl || 'http://localhost:3001/api/chat';

  const style = document.createElement('style');
  style.textContent = `
    .rr-chat-launcher {
      position: fixed; bottom: 20px; right: 20px;
      width: 56px; height: 56px; border-radius: 50%;
      background: #2563eb; color: white; border: none; cursor: pointer;
      font-size: 24px; z-index: 999999; box-shadow: 0 8px 30px rgba(0,0,0,0.2);
    }
    .rr-chat-panel {
      position: fixed; bottom: 84px; right: 20px;
      width: 320px; height: 420px; background: white;
      border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      display: none; flex-direction: column; overflow: hidden; z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .rr-chat-panel.open { display: flex; }
    .rr-messages { flex: 1; overflow-y: auto; padding: 12px; }
    .rr-bubble { padding: 8px 12px; border-radius: 10px; margin-bottom: 8px; max-width: 80%; font-size: 14px; }
    .rr-bubble.user { background: #2563eb; color: white; margin-left: auto; }
    .rr-bubble.assistant { background: #f1f5f9; color: #111; }
    .rr-input-row { display: flex; border-top: 1px solid #eee; }
    .rr-input-row input { flex: 1; border: none; padding: 10px; font-size: 14px; }
    .rr-input-row input:focus { outline: none; }
    .rr-input-row button { border: none; background: #2563eb; color: white; padding: 10px 14px; cursor: pointer; }
    .rr-cursor { display: inline-block; width: 2px; height: 1em; margin-left: 2px; background: #111; vertical-align: text-bottom; animation: rr-blink 0.8s steps(1) infinite; }
    @keyframes rr-blink { 50% { opacity: 0; } }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'rr-chat-panel';
  panel.innerHTML = `
    <div class="rr-messages"></div>
    <div class="rr-input-row">
      <input placeholder="Ask about this resume…" />
      <button>Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  const launcher = document.createElement('button');
  launcher.className = 'rr-chat-launcher';
  launcher.textContent = '💬';
  document.body.appendChild(launcher);

  const messagesEl = panel.querySelector('.rr-messages');
  const inputEl = panel.querySelector('input');
  const sendBtn = panel.querySelector('button');

  launcher.addEventListener('click', () => panel.classList.toggle('open'));
  sendBtn.addEventListener('click', sendChatMessage);
  inputEl.addEventListener('keydown', e => e.key === 'Enter' && sendChatMessage());

  function typeIntoBubble(bubble, fullText, charsPerTick = 2, tickMs = 20) {
    return new Promise(resolve => {
      bubble.textContent = '';
      const cursor = document.createElement('span');
      cursor.className = 'rr-cursor';
      bubble.appendChild(cursor);

      let i = 0;
      const interval = setInterval(() => {
        i = Math.min(i + charsPerTick, fullText.length);
        bubble.textContent = fullText.slice(0, i);
        if (i < fullText.length) {
          bubble.appendChild(cursor);
        } else {
          clearInterval(interval);
          resolve();
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }, tickMs);
    });
  }

  async function sendChatMessage() {
    const question = inputEl.value.trim();
    if (!question) return;

    const userBubble = document.createElement('div');
    userBubble.className = 'rr-bubble user';
    userBubble.textContent = question;
    messagesEl.appendChild(userBubble);
    inputEl.value = '';

    const thinkingBubble = document.createElement('div');
    thinkingBubble.className = 'rr-bubble assistant';
    thinkingBubble.textContent = 'Thinking…';
    messagesEl.appendChild(thinkingBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      const answer = data.results[0]?.text || "I couldn't find an answer.";
      await typeIntoBubble(thinkingBubble, answer);
    } catch (error) {
      thinkingBubble.textContent = '⚠️ Something went wrong.';
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
})();
