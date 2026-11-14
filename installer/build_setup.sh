#!/usr/bin/env bash
# Хэлмэрч-ийн Setup.exe бүтээх (Linux дээр): micromamba-аар Windows Python + PyPI-ийн win_amd64 wheel + NSIS
# Хэрэглээ: installer/build_setup.sh <ажлын хавтас>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SRC="$(dirname "$HERE")"
WORK="${1:-/tmp/helmerch-build}"; mkdir -p "$WORK"
VERSION=$(python3 -c "import re;print(re.search(r'VERSION = \"([\d.]+)\"',open('$SRC/server/hadmal_server.py',encoding='utf-8').read()).group(1))")
PY="$WORK/pyenv"
if [ ! -x "$PY/python.exe" ]; then
  [ -x "$WORK/mm/bin/micromamba" ] || { curl -sSL https://conda.anaconda.org/conda-forge/linux-64/micromamba-2.10.0-0.tar.bz2 -o "$WORK/mm.tar.bz2"; mkdir -p "$WORK/mm"; tar -xjf "$WORK/mm.tar.bz2" -C "$WORK/mm"; }
  MAMBA_ROOT_PREFIX="$WORK/mroot" "$WORK/mm/bin/micromamba" create -y -p "$PY" --platform win-64 -c conda-forge --override-channels "python=3.13" tk pip
  [ -d "$PY/lib/python3.13/site-packages" ] && mv "$PY"/lib/python3.13/site-packages/pip* "$PY/Lib/site-packages/" && rm -rf "$PY/lib"
  pip install -q --target "$PY/Lib/site-packages" --platform win_amd64 --python-version 3.13 --implementation cp \
      --only-binary=:all: --upgrade -r "$SRC/server/requirements.txt" deno colorama
  rm -rf "$PY"/Lib/site-packages/{Xlib,python_xlib-*}
  rm -rf "$PY"/{conda-meta,include,libs,Tools} "$PY"/Lib/{test,idlelib,ensurepip,lib2to3} "$PY"/Library/include "$PY"/Library/lib/{cmake,pkgconfig}
  find "$PY" -name "*.pdb" -delete; find "$PY/Library/lib" -maxdepth 1 -name "*.lib" -delete
  find "$PY" -name "__pycache__" -type d -prune -exec rm -rf {} +
  mkdir -p "$PY/tcl" && cp -r "$PY/Library/lib/tcl8.6" "$PY/Library/lib/tk8.6" "$PY/tcl/"
fi
STAGE="$WORK/stage"; rm -rf "$STAGE"; mkdir -p "$STAGE/server"
cp -r "$PY" "$STAGE/python"
cp "$SRC"/server/*.py "$SRC"/server/*.pyw "$SRC"/server/requirements*.txt "$STAGE/server/"
cp -r "$SRC/server/ui" "$STAGE/server/ui"
cp -r "$SRC/extension" "$STAGE/extension"
cp "$SRC/ZAAVAR.html" "$SRC/README.txt" "$STAGE/"
find "$STAGE" -name "__pycache__" -type d -prune -exec rm -rf {} +
cd "$HERE"
makensis -V2 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$WORK/Helmerch-Setup-$VERSION.exe" helmerch.nsi
ls -la "$WORK/Helmerch-Setup-$VERSION.exe"
