#!/bin/sh
# usage: mont.sh out.jpg t1 t2 ... (stills must exist)
cd "$(dirname "$0")/out/stills"; F="../../../video/node_modules/ffmpeg-static/ffmpeg"; o=$1; shift; a=""; n=0; for t in "$@"; do a="$a -i t$t.png"; n=$((n+1)); done
$F -y $a -filter_complex "$(i=0; for t in "$@"; do printf "[$i:v]scale=960:-1[s$i];"; i=$((i+1)); done)$(i=0; for t in "$@"; do printf "[s$i]"; i=$((i+1)); done)xstack=inputs=$n:layout=$(i=0; for t in "$@"; do printf "$(( (i%2)*960 ))_$(( (i/2)*540 ))"; i=$((i+1)); [ $i -lt $n ] && printf "|"; done)" ../$o -loglevel error
