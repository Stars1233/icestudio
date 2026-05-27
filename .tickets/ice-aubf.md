---
id: ice-aubf
status: closed
deps: []
links: []
created: 2026-05-23T16:19:16Z
type: task
priority: 2
assignee: ProbabilityEngineer
---
# Get icestudio building/running on macOS

Clone ProbabilityEngineer/icestudio, initialize jj/git/tk, reproduce macOS compile/start failures, and make the project run locally.

## Notes

**2026-05-23T16:24:10Z**

Reproduced macOS ARM build failures. npm install failed under npm 11 due grunt-wget peer conflict; added legacy-peer-deps in .npmrc. buildOSXARM64 then failed because nw-builder expected bare NW version instead of npm package version with -sdk suffix; stripped suffix in Gruntfile. Next failure was missing required macOS bundle metadata for nw-builder validation; added app metadata. Verified npm install, npm run jshint, and npm run buildOSXARM64 complete successfully, producing dist/icestudio-0.13.4w202605230505-osxarm64.dmg and .zip.
