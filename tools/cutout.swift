// REELIX subject cut-out with Apple Vision (macOS 14+, offline, free).
//   cutout <in.png> <out.png> [--largest]   one transparent PNG, same size as the input (2.5D parallax layers)
//   cutout <in.png> --each <dir>            one PNG per person/animal, cropped to it (character references)
// Prints JSON. With --each: {"people":[{"file":..., "box":[x,y,w,h] (0-1, top-left origin), "area":...}]} sorted left to right.
import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins

let a = CommandLine.arguments
guard a.count >= 3 else { print("usage: cutout <in.png> <out.png> [--largest] | cutout <in.png> --each <dir>"); exit(2) }
guard let img = CIImage(contentsOf: URL(fileURLWithPath: a[1])) else { print("cannot read \(a[1])"); exit(1) }
let req = VNGenerateForegroundInstanceMaskRequest()
let h = VNImageRequestHandler(ciImage: img)
do { try h.perform([req]) } catch { print("vision failed: \(error)"); exit(1) }
guard let r = req.results?.first, !r.allInstances.isEmpty else { print("{\"subjects\":0,\"people\":[]}"); exit(3) }
let ctx = CIContext(); let cs = CGColorSpace(name: CGColorSpace.sRGB)!

/// mask pixels of one or more instances: (count, bounding box in pixels, top-left origin)
func stats(_ set: IndexSet) -> (Int, CGRect) {
  guard let m = try? r.generateScaledMaskForImage(forInstances: set, from: h) else { return (0, .zero) }
  CVPixelBufferLockBaseAddress(m, .readOnly); defer { CVPixelBufferUnlockBaseAddress(m, .readOnly) }
  let w = CVPixelBufferGetWidth(m), hh = CVPixelBufferGetHeight(m), row = CVPixelBufferGetBytesPerRow(m)
  let p = CVPixelBufferGetBaseAddress(m)!.assumingMemoryBound(to: Float32.self)
  var n = 0, x0 = w, y0 = hh, x1 = 0, y1 = 0
  for y in stride(from: 0, to: hh, by: 2) { for x in stride(from: 0, to: w, by: 2) where p[y * row / 4 + x] > 0.5 {
    n += 1; x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y) } }
  return (n, n > 0 ? CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0) : .zero)
}
func cut(_ set: IndexSet) -> CIImage? {
  guard let mask = try? r.generateScaledMaskForImage(forInstances: set, from: h) else { return nil }
  let f = CIFilter.blendWithMask()
  f.inputImage = img; f.backgroundImage = CIImage.empty().cropped(to: img.extent); f.maskImage = CIImage(cvPixelBuffer: mask)
  return f.outputImage
}

if a[2] == "--each" {
  guard a.count >= 4 else { print("--each needs a folder"); exit(2) }
  let dir = a[3]; try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
  let W = img.extent.width, H = img.extent.height, total = W * H / 4
  // People standing close together come back as ONE foreground shape, so split it with body detection when it finds more people.
  let body = VNDetectHumanRectanglesRequest(); body.upperBodyOnly = false
  try? h.perform([body])
  var boxes: [(IndexSet, CGRect)] = []   // which mask + where (pixels, top-left origin)
  for i in r.allInstances { let s = stats(IndexSet(integer: i)); if Double(s.0) > Double(total) * 0.01 { boxes.append((IndexSet(integer: i), s.1)) } }  // ignore specks under 1%
  let humans = (body.results ?? []).filter { $0.confidence > 0.3 }.map { o -> CGRect in
    let b = o.boundingBox; return CGRect(x: b.minX * W, y: (1 - b.maxY) * H, width: b.width * W, height: b.height * H) }
  if humans.count > boxes.count { boxes = humans.map { (r.allInstances, $0.insetBy(dx: -$0.width * 0.06, dy: -$0.height * 0.04)) } }
  // Painted close-ups often hide bodies from the detector: if there are more FACES than shapes, split the shape into columns between the faces.
  let fr = VNDetectFaceRectanglesRequest(); try? h.perform([fr])
  let faces = (fr.results ?? []).map { $0.boundingBox }.filter { $0.width * $0.height > 0.004 }.sorted { $0.midX < $1.midX }
  if faces.count > boxes.count {
    let all = stats(r.allInstances).1
    let cx = faces.map { $0.midX * W }
    boxes = cx.indices.map { i in
      let x0 = i == 0 ? all.minX : (cx[i - 1] + cx[i]) / 2, x1 = i == cx.count - 1 ? all.maxX : (cx[i] + cx[i + 1]) / 2
      return (r.allInstances, CGRect(x: x0, y: all.minY, width: x1 - x0, height: all.height)) }
  }
  boxes.sort { $0.1.minX < $1.1.minX }
  var out: [String] = []
  for (k, (set, b0)) in boxes.enumerated() {
    guard let o = cut(set) else { continue }
    let b = b0.intersection(CGRect(x: 0, y: 0, width: W, height: H)); let pad: CGFloat = 12
    // CIImage has a bottom-left origin; b is top-left
    let crop = CGRect(x: max(0, b.minX - pad), y: max(0, H - b.maxY - pad), width: min(W, b.width + 2 * pad), height: min(H, b.height + 2 * pad))
    let file = "\(dir)/person\(k + 1).png"
    try? ctx.writePNGRepresentation(of: o.cropped(to: crop), to: URL(fileURLWithPath: file), format: .RGBA8, colorSpace: cs)
    out.append("{\"file\":\"\(file)\",\"box\":[\(String(format: "%.3f,%.3f,%.3f,%.3f", b.minX / W, b.minY / H, b.width / W, b.height / H))],\"area\":\(String(format: "%.3f", b.width * b.height / (W * H)))}")
  }
  print("{\"subjects\":\(r.allInstances.count),\"people\":[\(out.joined(separator: ","))]}")
  exit(0)
}

var keep = r.allInstances
if a.contains("--largest") && keep.count > 1 { keep = IndexSet(integer: keep.max { stats(IndexSet(integer: $0)).0 < stats(IndexSet(integer: $1)).0 }!) }
guard let out = cut(keep) else { print("mask failed"); exit(1) }
do { try ctx.writePNGRepresentation(of: out, to: URL(fileURLWithPath: a[2]), format: .RGBA8, colorSpace: cs) } catch { print("write failed: \(error)"); exit(1) }
print("{\"subjects\":\(r.allInstances.count),\"kept\":\(keep.count)}")
