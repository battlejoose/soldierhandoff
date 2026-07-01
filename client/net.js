// WebSocket client with auto-reconnect
export class Net {
  constructor() {
    this.handlers = {};
    this.ws = null;
    this.connected = false;
    this.pendingJoin = undefined; // may be null (auto-assign), so use undefined as "none"
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => {
      this.connected = true;
      this.handlers.open?.();
      if (this.pendingJoin !== undefined) this.send({ t: 'join', team: this.pendingJoin });
    };
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handlers[msg.t]?.(msg);
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.handlers.close?.();
      setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => this.ws.close();
  }

  join(team) {
    this.pendingJoin = team;
    if (this.connected) this.send({ t: 'join', team });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  order(order) {
    this.send({ t: 'order', ...order });
  }
}
