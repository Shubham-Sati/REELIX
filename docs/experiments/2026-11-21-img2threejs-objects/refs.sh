#!/bin/bash
# Makes one reference picture per object with local FLUX (klein, offline) for img2threejs to rebuild. Times each one.
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"; cd "$ROOT"
STYLE="as a smooth glossy plastic toy figurine, 3/4 front view from slightly above, the whole object visible and centred, plain light grey studio background, soft even studio light, simple clean shapes, clear bright colours, no text"
while IFS='|' read -r name what; do
  [ -z "$name" ] && continue; [ -f "$HERE/3-reference-pictures/$name.png" ] && continue
  s=$(date +%s); python3 tools/image.py "A $what $STYLE" "$HERE/3-reference-pictures/$name.png" 768 768 11 klein > "$HERE/3-reference-pictures/$name.log" 2>&1
  echo "$name $(( $(date +%s) - s )) s" | tee -a "$HERE/3-reference-pictures/times.txt"
done <<'LIST'
rocks|small group of three grey boulders
mountain|snowy mountain peak with rocky slopes
pine|tall pine tree
palm|coconut palm tree with a curved trunk
tree|round leafy oak tree
nest|bird nest made of twigs with three blue eggs
cottage|small cottage house with a pitched roof, door, windows and chimney
townhouse|three storey town house with many windows
hut|round straw hut with a thatched cone roof
car|small red family car
bus|red city bus
train|green steam locomotive
bicycle|blue bicycle
motorbike|red motorbike
sailboat|small sailing boat with a white sail
plane|small propeller airplane
LIST
echo done
