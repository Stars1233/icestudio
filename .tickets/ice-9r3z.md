---
id: ice-9r3z
status: closed
deps: []
links: []
created: 2026-05-27T19:07:51Z
type: task
priority: 2
assignee: ProbabilityEngineer
---
# Update Icestudio toolchain pins to latest stable

Update local Icestudio Apio/toolchain version pins to latest stable releases and validate where possible.


## Notes

**2026-05-27T19:08:42Z**

Updated app/package.json Apio stable pin from 0.9.5/<1.0.0 to 1.4.2/<1.5.0 and removed obsolete extras list because Apio 1.4.2 now declares the programmer packages as direct dependencies rather than provides-extra entries. Updated common.js oss-cad-suite stable package pin from 0.0.9 to latest FPGAwars/tools-oss-cad-suite release tag 2026-03-24. Validated npm run jshint passes.

**2026-05-27T19:56:19Z**

Also changed macOS driver setup to stop running brew update before installing/linking libftdi/libffi, to reduce unsigned/quarantined Icestudio causing Homebrew portable Ruby quarantine/Gatekeeper issues. Added docs/macos-homebrew-driver-setup.md with investigation notes, current mitigation, and future safer UX options. Validated npm run jshint.
