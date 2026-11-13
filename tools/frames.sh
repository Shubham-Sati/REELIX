#!/bin/bash
# Pull N evenly spaced frames from a video for the self-check.  tools/frames.sh <video.mp4> <out_dir> [n=6]
set -e; n="${3:-6}"; mkdir -p "$2"
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
for i in $(seq 1 "$n"); do t=$(echo "$d*($i-0.5)/$n" | bc -l); ffmpeg -y -v error -ss "$t" -i "$1" -frames:v 1 -vf scale=540:-1 "$2/f$i.jpg"; done
ls "$2"
