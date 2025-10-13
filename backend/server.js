const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const fs = require('fs');
const os = require('os');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

let monitorInterval;

wss.on('connection', (ws) => {
    console.log('Client connected');
    let ptyProcess = null;
    let containerName = '';

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

            // Start monitoring AFTER a short delay to ensure cgroup files are created
            setTimeout(() => {
                startMonitoring(ws, containerName);
            }, 500); // 500ms delay

            ptyProcess.onData(data => {
                ws.send(data);
            });

            ptyProcess.onExit(({ exitCode, signal }) => {
                console.log(`Child process exited with code ${exitCode}`);
                ws.send('\n--- CONTAINER STOPPED OR DISCONNECTED ---');
                ws.close();
            });

        } else {
            ptyProcess.write(command);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (ptyProcess) {
            ptyProcess.kill();
        }
        stopMonitoring();
        if (containerName) {
            const cgroupPath = `/sys/fs/cgroup/${containerName}`;
            if(fs.existsSync(cgroupPath)) {
                try {
                    fs.rmdirSync(cgroupPath);
                    console.log(`Cleaned up cgroup: ${cgroupPath}`);
                } catch (err) {
                    // This may fail if container didn't clean up fully, which is ok.
                }
            }
        }
    });
});


function startMonitoring(ws, containerName) {
    let lastCpuTotal = 0;
    let lastSampleTime = Date.now();

    console.log(`[Monitor] Starting for container: '${containerName}'`);

    monitorInterval = setInterval(() => {
        const memPath = `/sys/fs/cgroup/${containerName}/memory.current`;
        const cpuPath = `/sys/fs/cgroup/${containerName}/cpu.stat`;

        let currentMemory = 0;
        let cpuUsage = 0;

        try {
            // Check for memory file
            if (fs.existsSync(memPath)) {
                const memData = fs.readFileSync(memPath, 'utf8');
                currentMemory = parseInt(memData, 10);
            } else {
                console.log(`[Monitor] WARN: Memory path not found: ${memPath}`);
            }

            // Check for CPU file
            if (fs.existsSync(cpuPath)) {
                const cpuStat = fs.readFileSync(cpuPath, 'utf8');
                const usageLine = cpuStat.split('\n').find(line => line.startsWith('usage_usec'));
                
                if (usageLine) {
                    const currentTotal = parseInt(usageLine.split(' ')[1], 10);
                    const currentTime = Date.now();
                    const timeDiff = (currentTime - lastSampleTime) * 1000; // time elapsed in microseconds

                    if (lastCpuTotal > 0 && timeDiff > 0) {
                        const usageDiff = currentTotal - lastCpuTotal; // CPU time used in microseconds
                        // Actual core usage is (CPU time used / time elapsed)
                        cpuUsage = (usageDiff / timeDiff) * 100;
                        cpuUsage = Math.max(0, Math.min(cpuUsage, 100)); // Clamp value between 0-100
                    }
                    lastCpuTotal = currentTotal;
                    lastSampleTime = currentTime;
                }
            } else {
                console.log(`[Monitor] WARN: CPU path not found: ${cpuPath}`);
            }

        } catch (error) {
            console.error(`[Monitor] ERROR reading cgroup files: ${error.message}`);
        }
        
        const memory = {
            current: isNaN(currentMemory) ? 0 : currentMemory,
            limit: 524288000 // 500 MiB
        };
        
        const cpu = { 
            usage: isNaN(cpuUsage) ? 0 : cpuUsage, 
            limit: 50 // The container is limited to 50% of a core
        };

        // Only send if the websocket is still open
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stats', memory, cpu }));
        }

    }, 1000); // Check every second
}


function stopMonitoring() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        console.log("[Monitor] Stopping monitor.");
    }
}


server.listen(3001, () => {
    console.log('ISO-BOX Backend Server Started');
    console.log('Server is listening on http://localhost:3001');
});