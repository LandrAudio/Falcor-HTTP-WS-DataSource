class DelayedFunction {
  constructor(delay = 600) {
    this.delay = delay;
  }

  run(callback) {
    this.cancel();
    this.runnable = setTimeout(() => {
      if (callback) {
        callback();
      }
      this.cancel();
    }, this.delay);
  }

  cancel() {
    if (this.runnable) {
      clearTimeout(this.runnable);
    }
    this.runnable = null;
  }

  isRunning() {
    return this.runnable !== null;
  }
}

export default DelayedFunction;
