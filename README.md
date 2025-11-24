ISO-BOX: A Custom Linux Container Engine 

ISO-BOX is a project that builds a Linux container from scratch using C++, Node.js, and React. It is designed to demonstrate the core operating system principles behind modern containerization technologies like Docker.

By interacting directly with the Linux Kernel, ISO-BOX creates isolated environments for processes, filesystems, and networks, while providing a modern web-based interface for control and monitoring.



🚀 Key Features


----------🛡️ Core Isolation (C++ Engine)--------------

The heart of the project is a C++ engine that leverages low-level Linux system calls to create a secure "sandbox":

Process Isolation (PID Namespace): The container has its own independent process tree (PID 1).

Filesystem Isolation (Mount Namespace & chroot): The container is jailed inside a minimal root filesystem, unable to access host files.

Hostname Isolation (UTS Namespace): Each container has a unique, custom hostname.

Network Isolation (Network Namespace): The container runs in a private network stack, isolated from the host's interfaces.


----------📊 Resource Management (Cgroups v2)-----------

ISO-BOX enforces strict hardware limits to prevent a single container from monopolizing system resources:

CPU Limit: Hard cap at 50% of a single CPU core.

Memory Limit: Hard cap at 500MB of RAM.


-------------🖥️ Interactive Web Control Panel--------------

A full-stack web application provides a user-friendly interface:

Real-time Terminal: A fully interactive shell (xterm.js) connected via WebSockets.

Live Monitoring: Real-time graphs visualize CPU and Memory usage.

Smart Alerts:

High CPU Warning: A modal alerts the user if CPU usage stays near the limit for >5 seconds.

OOM Killer Alert: A critical alert notifies the user if a process is killed by the kernel for exceeding memory limits.

Process Tree Visualization: View the container's internal process hierarchy in real-time.



🏗️ Architecture

The project follows a Three-Tier Architecture:

1 . Frontend (React): Handles the UI, terminal emulation, and data visualization.

2 . Backend (Node.js): Acts as the bridge. It launches the C++ engine in a pseudo-terminal (node-pty) and streams data between the frontend and the container via WebSockets.

3 . Core Engine (C++): The executable that interfaces with the Linux Kernel to create the namespaces and apply cgroups.



🛠️ Installation & Setup

Prerequisites

- Linux OS (or WSL2 on Windows)
- g++ (Compiler)
- Node.js & npm
- util-linux (for nsenter)



▶️ How to Run

You will need two separate terminals.

Terminal 1: Start Backend Server
Note: Must be run with sudo to manage cgroups and namespaces.

cd backend
sudo node server.js


Terminal 2: Start Frontend UI

cd frontend
npm start


Open your browser to http://localhost:3000 to access the ISO-BOX Control Panel.

