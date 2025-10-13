#define _GNU_SOURCE
#include <sched.h>
#include <unistd.h>
#include <sys/wait.h>
#include <iostream>
#include <string>
#include "../include/container.h"
#include "../include/cgroups.h"

using namespace std;

// Global variable shared with the child function
string container_Name;

// main now accepts command-line arguments
int main(int argc, char *argv[]) {
    // Check if a container name was provided as an argument
    if (argc > 1) {
        container_Name = argv[1];
    } else {
        // Fallback if no name is provided
        container_Name = "ISO_BOX";
    }

    const int STACK_SIZE = 1024 * 1024;
    char* stack = new char[STACK_SIZE];
    char* stackTop = stack + STACK_SIZE;

    int pid = clone(
        childFunc,
        stackTop,
        CLONE_NEWPID | CLONE_NEWUTS | CLONE_NEWNS | SIGCHLD,
        nullptr
    );

    if (pid < 0) {
        perror("clone");
        delete[] stack;
        return 1;
    }

    cout << "\nCreated container process in host with PID: " << pid << endl;

    // Setup Cgroup for the new process
    setupCgroup(pid, container_Name);

   
    // server to communicate with the container's shell.
    waitpid(pid, nullptr, 0);

    // Clean up the cgroup directory after the container stops.
    cleanupCgroup(container_Name);
   

    delete[] stack;
    
    // This code is now reached only after the container has stopped.
    cout << "\nContainer stopped. Cleaning up." << endl;
    return 0;
}