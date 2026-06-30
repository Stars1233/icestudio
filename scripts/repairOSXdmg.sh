#!/bin/sh

#-- Terminal colors
NC="\033[0m"        #-- Reset colors
BLUE="\033[1;34m"
RED="\033[1;31m"
GREEN="\033[1;32m"

#-- Icestudio icon (used for the .dmg file's Finder icon)
ICNS="docs/resources/images/logo/icestudio-logo.icns"

#-- Give a .dmg file the Icestudio icon in Finder (custom-icon resource fork +
#-- HasCustomIcon flag). NOTE: resource forks are stripped by HTTP downloads, so
#-- this shows for local / direct-copy distribution; a browser-downloaded .dmg
#-- falls back to the generic disk-image icon (a macOS limitation).
set_dmg_icon() {
    dmg="$1"
    if [ -f "${ICNS}" ]; then
        tmpicns="$(mktemp -t dmgicon)"
        cp "${ICNS}" "${tmpicns}"
        sips -i "${tmpicns}" >/dev/null 2>&1
        DeRez -only icns "${tmpicns}" > "${tmpicns}.rsrc" 2>/dev/null
        Rez -append "${tmpicns}.rsrc" -o "${dmg}" 2>/dev/null
        SetFile -a C "${dmg}"
        rm -f "${tmpicns}" "${tmpicns}.rsrc"
        echo "    =>${GREEN}DMG icon set for ${dmg}${NC}"
    fi
}

#-- Start repairing
#-- The .dmg is created in dist/ (dist/icestudio-<ver>-osx64.dmg), so look there.
APPDIR="dist/"
if [ -d $APPDIR ]; then
    # Iterate over .dmg files in dist
    for dmg in `ls ${APPDIR}*.dmg`; do
        echo "${dmg}"
        if [ -f "${dmg}" ]; then
            if [ -n "${CODESIGN_ID}" ]; then
                echo "${GREEN}Sign OSX bundle for ${dmg}${NC}"
                codesign --force --deep --sign "${CODESIGN_ID}" "${dmg}"
            fi
            #-- Set the Finder icon after signing (it survives ad-hoc signing
            #-- and does not invalidate the dmg signature).
            set_dmg_icon "${dmg}"
        fi
    done
else
    echo "    =>${RED} OSX bundle not found"
fi
