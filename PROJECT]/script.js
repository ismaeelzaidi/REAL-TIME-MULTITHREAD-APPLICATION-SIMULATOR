// --- Simulation State ---
let userThreads = [];    // {id, state, mappedKernelId, inCritical}
let kernelThreads = [];  // {id, runningUserId}
let model = 'manyToOne';
let tick = 0;
let semaphore = 1;       // binary semaphore: 1 = available, 0 = busy
let intervalId = null;

// --- DOM Elements ---
const modelSelect = document.getElementById('modelSelect');
const userThreadCountInput = document.getElementById('userThreadCount');
const kernelThreadCountInput = document.getElementById('kernelThreadCount');
const initBtn = document.getElementById('initBtn');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stepBtn = document.getElementById('stepBtn');
const resetBtn = document.getElementById('resetBtn');
const userThreadTableBody = document.querySelector('#userThreadTable tbody');
const kernelThreadTableBody = document.querySelector('#kernelThreadTable tbody');
const logDiv = document.getElementById('log');
const semaphoreStatus = document.getElementById('semaphoreStatus');
const tickCounter = document.getElementById('tickCounter');
const modelExplanation = document.getElementById('modelExplanation');
const modelBadge = document.getElementById('currentModelBadge');

// --- Helper: Logging ---
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  logDiv.textContent += `[${timestamp}] ${message}\n`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

// --- Helper: Render Tables ---
function render() {
  // Render user threads
  userThreadTableBody.innerHTML = '';
  userThreads.forEach(t => {
    const tr = document.createElement('tr');

    const tdId = document.createElement('td');
    tdId.textContent = 'T' + t.id;
    tr.appendChild(tdId);

    const tdState = document.createElement('td');
    const spanState = document.createElement('span');
    spanState.textContent = t.state;
    spanState.className = 'tag ' + t.state;
    tdState.appendChild(spanState);
    tr.appendChild(tdState);

    const tdMapped = document.createElement('td');
    tdMapped.textContent = t.mappedKernelId ? 'K' + t.mappedKernelId : '-';
    tr.appendChild(tdMapped);

    const tdCritical = document.createElement('td');
    tdCritical.textContent = t.inCritical ? 'YES' : 'NO';
    tr.appendChild(tdCritical);

    userThreadTableBody.appendChild(tr);
  });

  // Render kernel threads
  kernelThreadTableBody.innerHTML = '';
  kernelThreads.forEach(k => {
    const tr = document.createElement('tr');
    const tdId = document.createElement('td');
    tdId.textContent = 'K' + k.id;
    tr.appendChild(tdId);

    const tdRunning = document.createElement('td');
    tdRunning.textContent = k.runningUserId ? ('T' + k.runningUserId) : 'IDLE';
    tr.appendChild(tdRunning);

    kernelThreadTableBody.appendChild(tr);
  });

  // Render semaphore
  if (semaphore === 1) {
    semaphoreStatus.textContent = 'Available (1)';
    semaphoreStatus.className = 'semaphore ok';
  } else {
    semaphoreStatus.textContent = 'Busy (0)';
    semaphoreStatus.className = 'semaphore busy';
  }

  tickCounter.textContent = tick.toString();
  updateModelExplanation();
}

function updateModelExplanation() {
  let text = '';
  if (model === 'manyToOne') {
    text = 'Many-to-One: Multiple user threads are mapped to a single kernel thread. If one user thread blocks, all user threads are effectively blocked.';
    modelBadge.textContent = 'Many-to-One';
  } else if (model === 'oneToOne') {
    text = 'One-to-One: Each user thread is mapped to a separate kernel thread. Blocking one thread does not block others.';
    modelBadge.textContent = 'One-to-One';
  } else {
    text = 'Many-to-Many: Multiple user threads are multiplexed over a pool of kernel threads. Blocking one user thread does not block all, and the system balances flexibility and resource usage.';
    modelBadge.textContent = 'Many-to-Many';
  }
  modelExplanation.textContent = text;
}

// --- Thread Mapping according to model ---
function updateKernelMappings() {
  const n = userThreads.length;
  if (model === 'manyToOne') {
    kernelThreads = [{ id: 1, runningUserId: null }];
    userThreads.forEach(t => t.mappedKernelId = 1);
  } else if (model === 'oneToOne') {
    kernelThreads = [];
    userThreads.forEach((t, index) => {
      const kid = index + 1;
      t.mappedKernelId = kid;
      kernelThreads.push({ id: kid, runningUserId: null });
    });
  } else { // manyToMany
    const kCount = Math.max(1, parseInt(kernelThreadCountInput.value, 10) || 1);
    kernelThreads = [];
    for (let i = 0; i < kCount; i++) {
      kernelThreads.push({ id: i + 1, runningUserId: null });
    }
    userThreads.forEach((t, index) => {
      const mapped = (index % kCount) + 1;
      t.mappedKernelId = mapped;
    });
  }
}

// --- Initialize Threads ---
function initializeSimulation() {
  const count = Math.max(1, parseInt(userThreadCountInput.value, 10) || 1);
  model = modelSelect.value;
  tick = 0;
  semaphore = 1;
  userThreads = [];
  for (let i = 1; i <= count; i++) {
    userThreads.push({
      id: i,
      state: 'READY',
      mappedKernelId: null,
      inCritical: false
    });
  }
  updateKernelMappings();
  log('Simulation initialized with model = ' + model + ' and ' + count + ' user threads.');
  render();
}

// --- One Simulation Step ---
function stepSimulation() {
  tick++;

  log('--- Time Step ' + tick + ' ---');

  // Clear kernel running state
  kernelThreads.forEach(k => k.runningUserId = null);

  // Randomly unblock some blocked threads
  userThreads.forEach(t => {
    if (t.state === 'BLOCKED' && Math.random() < 0.3) {
      t.state = 'READY';
      log('T' + t.id + ' is unblocked (signal on semaphore/monitor).');
      semaphore = 1; // someone signalled
    }
  });

  // Pick READY threads to run (based on model)
  let readyThreads = userThreads.filter(t => t.state === 'READY');

  if (readyThreads.length === 0) {
    log('No READY threads. CPU is idle.');
  } else {
    if (model === 'manyToOne' || model === 'oneToOne') {
      // Only one thread effectively runs at a time (single CPU visualization)
      const chosen = readyThreads[Math.floor(Math.random() * readyThreads.length)];
      chosen.state = 'RUNNING';
      const kernelId = chosen.mappedKernelId || 1;
      const kernel = kernelThreads.find(k => k.id === kernelId);
      if (kernel) kernel.runningUserId = chosen.id;
      log('Scheduler selected T' + chosen.id + ' to RUN on K' + kernelId + '.');
    } else {
      // Many-to-Many: multiple kernel threads can run multiple ready threads
      let readyIndex = 0;
      kernelThreads.forEach(k => {
        if (readyIndex < readyThreads.length) {
          const t = readyThreads[readyIndex++];
          t.state = 'RUNNING';
          k.runningUserId = t.id;
          log('Scheduler mapped T' + t.id + ' to RUN on K' + k.id + '.');
        }
      });
    }
  }

  // Behaviour for RUNNING threads
  userThreads.forEach(t => {
    if (t.state === 'RUNNING') {
      const r = Math.random();
      if (r < 0.25 && semaphore === 1) {
        // Try to enter critical section with semaphore wait
        t.inCritical = true;
        semaphore = 0;
        log('T' + t.id + ' entered critical section using semaphore (wait).');
      } else if (r < 0.45) {
        // Block on semaphore/monitor
        t.state = 'BLOCKED';
        t.inCritical = false;
        log('T' + t.id + ' is BLOCKED waiting on semaphore/monitor.');
        if (model === 'manyToOne') {
          // Many-to-One: block all user threads because single kernel thread blocked
          userThreads.forEach(other => {
            if (other.state === 'READY') {
              other.state = 'BLOCKED';
            }
          });
          log('In Many-to-One, all user threads are blocked because the single kernel thread is blocked.');
        }
      } else if (r < 0.65) {
        // Finish execution
        t.state = 'TERMINATED';
        t.inCritical = false;
        log('T' + t.id + ' finished execution and TERMINATED.');
      } else {
        // Just used CPU time, stay RUNNING for this tick
        // (next tick scheduler may pick someone else)
      }
    }
  });

  // Release semaphore if a thread left critical section
  userThreads.forEach(t => {
    if (t.inCritical && t.state !== 'RUNNING') {
      t.inCritical = false;
      semaphore = 1;
      log('T' + t.id + ' left critical section and signalled semaphore.');
    }
  });

  // Convert all RUNNING to READY for next scheduling round (visualization)
  userThreads.forEach(t => {
    if (t.state === 'RUNNING') {
      t.state = 'READY';
    }
  });

  render();
}

// --- Start / Pause / Reset ---
function startSimulation() {
  if (intervalId) return;
  intervalId = setInterval(stepSimulation, 900); // 0.9 sec per step
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  stepBtn.disabled = true;
  log('Automatic simulation started.');
}

function pauseSimulation() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    log('Simulation paused.');
  }
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  stepBtn.disabled = false;
}

function resetSimulation() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  tick = 0;
  userThreads = [];
  kernelThreads = [];
  semaphore = 1;
  log('Simulation reset.');
  render();
  startBtn.disabled = true;
  pauseBtn.disabled = true;
  stepBtn.disabled = true;
  resetBtn.disabled = true;
}

// --- Event Listeners ---
modelSelect.addEventListener('change', () => {
  if (modelSelect.value === 'manyToMany') {
    kernelThreadCountInput.disabled = false;
  } else {
    kernelThreadCountInput.disabled = true;
  }
});

initBtn.addEventListener('click', () => {
  initializeSimulation();
  startBtn.disabled = false;
  stepBtn.disabled = false;
  resetBtn.disabled = false;
});

startBtn.addEventListener('click', startSimulation);
pauseBtn.addEventListener('click', pauseSimulation);
stepBtn.addEventListener('click', () => {
  if (!intervalId) {
    stepSimulation();
  }
});
resetBtn.addEventListener('click', resetSimulation);

// Initial explanation render
updateModelExplanation();
render();
