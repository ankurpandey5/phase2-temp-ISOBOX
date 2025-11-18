const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

let monitorIntervals = {};

function isWhileTrueLoop(cmd) {
    const cleanedCmd = cmd.trim().replace(/\s+/g, ' ').toLowerCase();
    console.log(`[LoopCheck] Checking: "${cleanedCmd}"`);
    
    
    const patterns = [
       
        /^\s*while\s+(true|:)\s*;?\s*do\s+(true|:)\s*;?\s*done\s*$/,
        /^\s*while\s+true\s*;?\s*do\s+true\s*;?\s*done\s*$/,
        /^\s*while\s+:\s*;?\s*do\s+:\s*;?\s*done\s*$/,
        
        
        /^\s*while\s+true\s*;?\s*do\s+true\s*;?\s*done\s*$/i, 
        /^\s*while\s+true\.*;?\s*do\s+true\.*;?\s*done\s*$/i, 
        /^\s*while\s+true\s*;?\s*do\s*true\s*;?\s*done\s*$/i, 
    ];
    
    // Also check if the command contains the key infinite loop keywords
    const hasLoopKeywords = 
        cleanedCmd.includes('while') && 
        cleanedCmd.includes('do') && 
        cleanedCmd.includes('done') &&
        (cleanedCmd.includes('true') || cleanedCmd.includes(':'));
    
    const isExactMatch = patterns.some(pattern => pattern.test(cleanedCmd));
    const isCloseMatch = hasLoopKeywords && (
        cleanedCmd.includes('true') || 
        cleanedCmd.includes('true;') ||
        cleanedCmd.includes('true ;')
    );
    
    console.log(`[LoopCheck] Exact match: ${isExactMatch}, Close match: ${isCloseMatch}`);
    
    // Return true for exact matches OR close matches that look like infinite loops
    return isExactMatch || isCloseMatch;
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    let ptyProcess = null;
    let containerName = '';
    let containerHostPid = null;
    let monitoringEnabled = false;
    let cgroupPath = null;
    let commandBuffer = '';

    ws.on('message', (message) => {
        const command = message.toString();

        if (!ptyProcess) {
            containerName = command.trim();
            console.log(`Received hostname: ${containerName}`);
            
            const args = ['./container_runner', containerName];
            ptyProcess = pty.spawn('sudo', args, {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: '../',
                env: process.env
            });

            ptyProcess.onData(data => {
                const dataStr = data.toString();
                
                if (!containerHostPid) {
                    const pidMatch = dataStr.match(/Created container process in host with PID: (\d+)/);
                    if (pidMatch && pidMatch[1]) {
                        containerHostPid = pidMatch[1];
                        console.log(`[Monitor] Captured Container PID: ${containerHostPid}`);
                        
                        // Set the cgroup path but DON'T start monitoring yet
                        cgroupPath = `/sys/fs/cgroup/${containerName}`;
                        console.log(`[Monitor] Cgroup path set to: ${cgroupPath} (monitoring not started yet)`);
                    }
                }
                ws.send(dataStr);
            });

            ptyProcess.onExit(({ exitCode, signal }) => {
                console.log(`Child process exited with code ${exitCode}`);
                ws.send('\n--- CONTAINER STOPPED OR DISCONNECTED ---');
                stopMonitoring(containerName);
                ws.close();
            });

        } else {
            // Handle manual refresh and kill commands
            try {
                const msg = JSON.parse(command);
                if (msg.type === 'GET_PROC_TREE') {
                    if (containerHostPid) {
                        console.log(`[ProcTree] Manual refresh triggered for PID: ${containerHostPid}`);
                        fetchProcTree(ws, containerHostPid);
                    } else {
                        ws.send(JSON.stringify({ 
                            type: 'proc_tree', 
                            data: 'Container PID not available yet. Please wait...' 
                        }));
                    }
                }
                else if (msg.type === 'KILL_CONTAINER') {
                    console.log("[Action] Received kill command from user. Terminating container.");
                    if (ptyProcess) {
                        ptyProcess.kill();
                    }
                    stopMonitoring(containerName);
                }
                return;
            } catch (e) {
                
                // Send ALL characters immediately to the terminal for real-time display
                ptyProcess.write(command);
                console.log(`[Terminal Input]: Sent to terminal: "${command.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`);
                
                // Only buffer and check for loops when Enter is pressed
                if (command.includes('\n') || command.includes('\r')) {
                    const completeCommand = commandBuffer + command;
                    console.log(`[Terminal Command Complete]: "${completeCommand.trim()}"`);
                    
                    // Check for infinite loop in the complete command
                    if (!monitoringEnabled && isWhileTrueLoop(completeCommand)) {
                        monitoringEnabled = true;
                        console.log("[Monitor] Infinite loop detected → Starting CPU monitoring NOW!");
                        
                        if (cgroupPath) {
                            startMonitoring(ws, containerName, cgroupPath, ptyProcess);
                        } else {
                            console.log("[Monitor] Warning: No cgroup path available, trying default path");
                            startMonitoring(ws, containerName, `/sys/fs/cgroup/${containerName}`, ptyProcess);
                        }
                    } else if (!monitoringEnabled) {
                        console.log(`[LoopCheck] Command not recognized as infinite loop: "${completeCommand.trim()}"`);
                        console.log(`[LoopCheck] Please type exactly: while true;do true;done`);
                    }
                    
                    // Reset the buffer for the next command
                    commandBuffer = '';
                } else {
                    // Accumulate characters for command processing (but they're already displayed)
                    commandBuffer += command;
                }
            }
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (ptyProcess) {
            ptyProcess.kill();
        }
        stopMonitoring(containerName);
    });
});

// --- Monitoring Function ---
function startMonitoring(ws, containerName, cgroupPath, ptyProcess) {
    if (monitorIntervals[containerName]) {
        console.log(`[Monitor] Monitoring already active for ${containerName}`);
        return;
    }

    let lastCpuTotal = 0;
    let lastSampleTime = Date.now();
    let cpuAlertSent = false;
    let lastOomKillCount = 0;

    // REMOVED GRACE PERIOD - start monitoring immediately
    
    const memEventsPath = `${cgroupPath}/memory.events`;
    
    try {
        if (fs.existsSync(memEventsPath)) {
            const memEventsData = fs.readFileSync(memEventsPath, 'utf8');
            const oomLine = memEventsData.split('\n').find(line => line.startsWith('oom_kill'));
            if (oomLine) {
                lastOomKillCount = parseInt(oomLine.split(' ')[1], 10);
            }
        }
    } catch (e) { 
        console.log("[Monitor] Failed to read initial OOM count"); 
    }

    console.log(`[Monitor] Starting IMMEDIATE stats for: '${containerName}' at cgroup: ${cgroupPath}`);

    const statsInterval = setInterval(() => {
        const memPath = `${cgroupPath}/memory.current`;
        const cpuPath = `${cgroupPath}/cpu.stat`;

        let currentMemory = 0;
        let cpuUsage = 0;

        try {
            // Always read memory
            if (fs.existsSync(memPath)) {
                const memData = parseInt(fs.readFileSync(memPath, 'utf8'), 10);
                if (!isNaN(memData)) {
                    currentMemory = memData;
                }
            }
            
            // CPU usage calculation - NO GRACE PERIOD
            if (fs.existsSync(cpuPath)) {
                const cpuStat = fs.readFileSync(cpuPath, 'utf8');
                const usageLine = cpuStat.split('\n').find(line => line.startsWith('usage_usec'));
                
                if (usageLine) {
                    const currentTotal = parseInt(usageLine.split(' ')[1], 10);
                    const currentTime = Date.now();
                    const timeDiff = (currentTime - lastSampleTime) * 1000; 

                    if (lastCpuTotal > 0 && timeDiff > 0) {
                        const usageDiff = currentTotal - lastCpuTotal; 
                        cpuUsage = (usageDiff / timeDiff) * 100;
                        cpuUsage = Math.max(0, Math.min(cpuUsage, 100));

                        console.log(`[Monitor] CPU Usage: ${cpuUsage.toFixed(2)}%`);

                        // MORE SENSITIVE DETECTION - trigger at 80% or higher
                        if (cpuUsage >= 50 && !cpuAlertSent) {
                            console.log("[Monitor] ⚠️  HIGH CPU USAGE DETECTED! Sending immediate warning...");
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ 
                                    type: 'alert', 
                                    level: 'warning', 
                                    message: '🚨 HIGH CPU USAGE DETECTED! The container is using excessive resources (' + cpuUsage.toFixed(1) + '% CPU). Do you want to kill it?' 
                                }));
                            }
                            cpuAlertSent = true;
                        }
                    }
                    
                    lastCpuTotal = currentTotal;
                    lastSampleTime = currentTime;
                } else {
                    if (lastCpuTotal === 0) {
                        lastCpuTotal = currentTotal;
                        lastSampleTime = currentTime;
                    }
                }
            }
            
            if (fs.existsSync(memEventsPath)) {
                // OOM Logic
                const memEventsData = fs.readFileSync(memEventsPath, 'utf8');
                const oomLine = memEventsData.split('\n').find(line => line.startsWith('oom_kill'));
                if (oomLine) {
                    const currentOomKillCount = parseInt(oomLine.split(' ')[1], 10);
                    if (currentOomKillCount > lastOomKillCount) {
                        console.log("[Monitor] OOM Kill Detected!");
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ 
                                type: 'alert', 
                                level: 'critical', 
                                message: '🚨 OOM KILL DETECTED! A process was killed due to memory exhaustion. It is recommended to kill the container.' 
                            }));
                        }
                        lastOomKillCount = currentOomKillCount; 
                    }
                }
            }
        } catch (error) {
            console.log(`[Monitor] Error reading stats: ${error.message}`);
        }
        
        const memory = {
            current: isNaN(currentMemory) ? 0 : currentMemory,
            limit: 524288000
        };
        const cpu = { 
            usage: isNaN(cpuUsage) ? 0 : cpuUsage, 
            limit: 50
        };

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stats', memory, cpu }));
        }

    }, 1000); // Check every second

    monitorIntervals[containerName] = statsInterval;
    console.log(`[Monitor] Monitoring interval started for ${containerName}`);
}

function stopMonitoring(containerName) {
    if (containerName && monitorIntervals[containerName]) {
        clearInterval(monitorIntervals[containerName]);
        delete monitorIntervals[containerName];
        console.log(`[Monitor] Stopped monitoring for ${containerName}`);
    }
}

server.listen(3001, () => {
    console.log('ISO-BOX Backend Server Started');
    console.log('Server is listening on http://localhost:3001');
});