#define _GNU_SOURCE
#include "../include/container.h"
#include <sched.h>
#include <unistd.h>
#include <sys/mount.h> 
#include <iostream>
#include <cstring>

// Reference the global variable defined in main.cpp
extern std::string container_Name;

int childFunc(void* args) {
    // Mount a new /proc filesystem for the new PID namespace
    if (mount("proc", "/proc", "proc", 0, "") != 0) {
        perror("mount");
        return 1;
    }

    if (sethostname(container_Name.c_str(), container_Name.size()) != 0) {
        perror("sethostname");
        return 1;
    }

   
    if (chdir("/root") != 0) {
        perror("chdir");
        // We can continue even if this fails
    }
    

    std::cout << "\nContainer Created\nInside Container\n";
    char hostname[1024];
    gethostname(hostname, sizeof(hostname));
    std::cout << "PID inside namespace: " << getpid() << std::endl;
    std::cout << "Hostname inside container: " << hostname << std::endl;

    char* const args_exec[] = { (char*)"/bin/bash", nullptr };
    execvp("/bin/bash", args_exec);

    // This part should not be reached if execvp is successful
    perror("execvp");
    return 1;
}
