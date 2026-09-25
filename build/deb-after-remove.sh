#!/bin/bash
# Replaces electron-builder's default after-remove template.
# Note: avoid ${...} shell syntax — electron-builder substitutes those as template vars.

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'lampstand' '/usr/bin/lampstand'
else
    rm -f '/usr/bin/lampstand'
fi

rm -f '/usr/share/metainfo/com.tejashingu.lampstand.metainfo.xml'
rm -f '/usr/share/applications/lampstand-admin.desktop'
