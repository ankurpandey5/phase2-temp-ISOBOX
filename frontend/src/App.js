import React, { useState, useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import 'xterm/css/xterm.css';
import './App.css';

// Custom Label component for the center of the chart
const ChartLabel = ({ viewBox, value, unit }) => {
  const { cx, cy } = viewBox;
  return (
    <>
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill="#ecf0f1" fontSize="24" fontWeight="600">
        {value}
      </text>
      <text x={cx} y={cy} dy="20" textAnchor="middle" fill="#bdc3c7" fontSize="12">
        {unit}
      </text>
    </>
  );
};


function App() {
  const terminalRef = useRef(null);
  const ws = useRef(null);
  const termInstance = useRef(null);
  const [hostname, setHostname] = useState('isobox-container');
  const [isContainerRunning, setIsContainerRunning] = useState(false);
  const [stats, setStats] = useState({
    memory: { current: 0, limit: 524288000 },
    cpu: { usage: 0, limit: 50 }
  });

  useEffect(() => {
    // This effect sets up the terminal and only runs once. It's correct.
    if (terminalRef.current && !termInstance.current) {
      const fitAddon = new FitAddon();
      const term = new Terminal({ convertEol: true, cursorBlink: true, rows: 20, theme: { background: '#1e2a38' } });
      termInstance.current = term;
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();
      term.onData(data => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(data);
        }
      });
      const resizeListener = () => fitAddon.fit();
      window.addEventListener('resize', resizeListener);

      return () => {
        window.removeEventListener('resize', resizeListener);
        if (termInstance.current) {
          termInstance.current.dispose();
          termInstance.current = null;
        }
      };
    }
  }, []);

  const startContainer = () => {
    const term = termInstance.current;
    if (!term) return;
    term.clear();
    term.writeln('Connecting to ISO-BOX server...');
    ws.current = new WebSocket('ws://localhost:3001');

    ws.current.onopen = () => {
      setIsContainerRunning(true);
      term.writeln('Connection successful. Starting container...');
      ws.current.send(hostname);
    };

    ws.current.onmessage = (event) => {
      try {
        const messageData = JSON.parse(event.data);
        if (messageData.type === 'stats') {
          // Here is where we receive the stats from the backend
          setStats(messageData);
        }
      } catch (e) {
        // This handles regular terminal output
        term.write(event.data);
      }
    };

    ws.current.onclose = () => {
      setIsContainerRunning(false);
      setStats({ memory: { current: 0, limit: 524288000 }, cpu: { usage: 0, limit: 50 } });
      term.writeln('\n\n\x1b[31m--- CONTAINER STOPPED OR DISCONNECTED ---\x1b[0m');
    };

    ws.current.onerror = (error) => {
      setIsContainerRunning(false);
      term.writeln(`\n\n\x1b[31m--- CONNECTION ERROR ---\x1b[0m`);
    };
  };

  const stopContainer = () => {
    if (ws.current) ws.current.close();
  };
  
  // --- FIX APPLIED: Correct data preparation for charts ---

  // Memory Chart Data
  const memUsageMB = stats.memory.current / (1024 * 1024);
  const memLimitMB = stats.memory.limit / (1024 * 1024);
  const memPercent = memLimitMB > 0 ? (memUsageMB / memLimitMB) * 100 : 0;
  const memData = [{ name: 'Memory', value: memPercent }];

  // CPU Chart Data
  // 'stats.cpu.usage' is the container's usage of a single core (e.g., 45.7%)
  // 'stats.cpu.limit' is the cap we set (50%)
  // We calculate what percentage of the CAP is being used.
  const cpuPercentOfLimit = stats.cpu.limit > 0 ? (stats.cpu.usage / stats.cpu.limit) * 100 : 0;
  const cpuData = [{ name: 'CPU', value: cpuPercentOfLimit }];

  return (
    <div className="app-container">
      <header className="app-header"><h1>ISO-BOX Control Panel</h1></header>
      <div className="main-content">
        <div className="controls-panel">
          <h2>Configuration</h2>
          <div className="status">
            <span className={`status-dot ${isContainerRunning ? 'running' : 'stopped'}`}></span>
            Status: {isContainerRunning ? 'Running' : 'Stopped'}
          </div>
          <label htmlFor="hostname">Container Hostname</label>
          <input
            type="text"
            id="hostname"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            disabled={isContainerRunning}
          />
          <div className="button-group">
            <button onClick={startContainer} disabled={isContainerRunning}>Create Container</button>
            <button onClick={stopContainer} disabled={!isContainerRunning} className="stop-button">Stop Container</button>
          </div>
        </div>
        <div className="terminal-container" ref={terminalRef}></div>
        <div className="monitoring-panel">
          <h2>Resource Monitoring</h2>
          <div className="resource-chart">
            <h3>CPU Usage</h3>
            <ResponsiveContainer width="100%" height={200}>
              <RadialBarChart 
                innerRadius="70%" 
                outerRadius="90%" 
                data={cpuData} 
                startAngle={90} 
                endAngle={-270}
                barSize={20}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar background={{ fill: '#34495e' }} clockWise dataKey="value" fill="#e67e22" cornerRadius={10} />
                <ChartLabel value={`${cpuPercentOfLimit.toFixed(0)}%`} unit={`of 50% Limit`} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <div className="resource-chart">
            <h3>Memory Usage</h3>
            <ResponsiveContainer width="100%" height={200}>
              <RadialBarChart 
                innerRadius="70%" 
                outerRadius="90%" 
                data={memData} 
                startAngle={90} 
                endAngle={-270}
                barSize={20}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar background={{ fill: '#34495e' }} clockWise dataKey="value" fill="#3498db" cornerRadius={10} />
                <ChartLabel value={`${memUsageMB.toFixed(1)}`} unit={`/ ${memLimitMB.toFixed(0)} MB`} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;