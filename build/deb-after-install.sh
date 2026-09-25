#!/bin/bash
# Replaces electron-builder's default after-install template, so everything the
# default did (binary symlink, chrome-sandbox SUID, desktop/mime refresh) has to
# be repeated here, alongside our own additions.
# Note: avoid ${...} shell syntax — electron-builder substitutes those as template vars.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/lampstand' -a -e '/usr/bin/lampstand' -a "`readlink '/usr/bin/lampstand'`" != '/etc/alternatives/lampstand' ]; then
        rm -f '/usr/bin/lampstand'
    fi
    update-alternatives --install '/usr/bin/lampstand' 'lampstand' '/opt/Lampstand/lampstand' 100 || ln -sf '/opt/Lampstand/lampstand' '/usr/bin/lampstand'
else
    ln -sf '/opt/Lampstand/lampstand' '/usr/bin/lampstand'
fi

# SUID chrome-sandbox for Electron 5+
chmod 4755 '/opt/Lampstand/chrome-sandbox' || true

# AppStream metadata, so software centres show the developer and homepage
if [ -f '/opt/Lampstand/usr/share/metainfo/com.tejashingu.lampstand.metainfo.xml' ]; then
    mkdir -p '/usr/share/metainfo'
    cp -f '/opt/Lampstand/usr/share/metainfo/com.tejashingu.lampstand.metainfo.xml' '/usr/share/metainfo/com.tejashingu.lampstand.metainfo.xml' || true
fi

# Second launcher that starts Lampstand with root rights via a polkit prompt
if [ -f '/opt/Lampstand/resources/lampstand-admin.desktop' ]; then
    cp -f '/opt/Lampstand/resources/lampstand-admin.desktop' '/usr/share/applications/lampstand-admin.desktop' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
