# macOS Homebrew driver setup notes

Icestudio's macOS driver setup uses Homebrew to install/link user-space libraries used by FTDI/libusb-based boards.

Current macOS driver packages:

```sh
libftdi
libffi
```

The driver setup code is in:

```text
app/scripts/services/drivers.js
```

## Gatekeeper/quarantine issue observed

When Icestudio is distributed as an unsigned/unnotarized app, macOS may apply quarantine metadata to the app after it is copied from a downloaded DMG. If Icestudio then launches Homebrew, files touched or downloaded by that Homebrew process can inherit quarantine metadata with `icestudio` as the source.

An observed failure was a Gatekeeper dialog:

```text
Apple could not verify “ruby” is free of malware that may harm your Mac or compromise your privacy.
```

Investigation showed Homebrew's portable Ruby had quarantine metadata:

```text
/opt/homebrew/Library/Homebrew/vendor/portable-ruby/current/bin/ruby
com.apple.quarantine: ...;icestudio;
```

This happened after Icestudio launched Homebrew as part of driver setup. The Ruby binary already existed, but its metadata changed during the Icestudio-launched Homebrew operation.

## Mitigation currently applied

Icestudio no longer runs `brew update` during macOS driver setup.

Previously the flow started with:

```sh
brew update
```

and then installed/linked the required packages. Running `brew update` increases the chance that Homebrew updates or touches its own portable Ruby and support files from the quarantined Icestudio process.

The current flow only runs package install/link commands for the required libraries.

## If this needs to be revisited

For unsigned fork builds, the safest behavior is probably to avoid running Homebrew directly from Icestudio at all. Instead, the app could show the commands and ask users to run them in Terminal:

```sh
brew install libftdi libffi
brew link --force libftdi
brew link --force libffi
```

A better UX would include:

- detecting whether `brew` exists;
- detecting whether `libftdi` and `libffi` are already installed;
- showing a copyable command block for missing dependencies;
- warning if Icestudio itself has `com.apple.quarantine` metadata;
- avoiding password prompts or `sudo` for Homebrew operations.

Avoid running Homebrew with `sudo`; Homebrew discourages this and it can create root-owned files under `/opt/homebrew` or `/usr/local`.

## Manual cleanup if quarantine is accidentally applied

If Homebrew files are quarantined by Icestudio, inspect with:

```sh
xattr -lr "$(brew --repository)" | grep -i quarantine
```

If the user trusts their Homebrew installation, quarantine metadata can be removed with:

```sh
xattr -dr com.apple.quarantine "$(brew --repository)"
```

Then verify Homebrew works normally:

```sh
brew update
brew doctor
```
