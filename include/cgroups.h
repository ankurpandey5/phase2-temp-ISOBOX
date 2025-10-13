#ifndef CGROUPS_H
#define CGROUPS_H
#include <string>

void setupCgroup(int pid, const std::string& containerName);
void cleanupCgroup(const std::string& containerName);

#endif // CGROUPS_H