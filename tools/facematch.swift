// REELIX face match with Apple Vision (offline, free): how close each face in a frame is to a character's reference.
//   facematch <ref.png> <frame.png> [<frame2.png> ...]
// Prints JSON lines: {"frame":..., "faces":[{"box":[x,y,w,h], "distance":d}], "best":d}
// distance: smaller = more alike (same person in the same style is usually well below the threshold the pipeline uses).
import Foundation
import Vision
import CoreImage

let a = CommandLine.arguments
guard a.count >= 3 else { print("usage: facematch <ref.png> <frame.png> ..."); exit(2) }
let ctx = CIContext()

func faces(_ path: String) -> (CIImage, [CGRect])? {
  guard let img = CIImage(contentsOf: URL(fileURLWithPath: path)) else { return nil }
  let r = VNDetectFaceRectanglesRequest(); try? VNImageRequestHandler(ciImage: img).perform([r])
  return (img, (r.results ?? []).map { $0.boundingBox }.filter { $0.width * $0.height > 0.002 })
}
func print_(_ img: CIImage, _ b: CGRect) -> VNFeaturePrintObservation? {
  let e = img.extent
  // a bit wider than the face box so hair and jaw line count too
  let r = CGRect(x: e.minX + (b.minX - b.width * 0.25) * e.width, y: e.minY + (b.minY - b.height * 0.2) * e.height,
                 width: b.width * 1.5 * e.width, height: b.height * 1.45 * e.height).intersection(e)
  let crop = img.cropped(to: r)
  guard let cg = ctx.createCGImage(crop, from: crop.extent) else { return nil }
  let q = VNGenerateImageFeaturePrintRequest(); try? VNImageRequestHandler(cgImage: cg).perform([q])
  return q.results?.first
}
guard let (ri, rf) = faces(a[1]), let big = rf.max(by: { $0.width * $0.height < $1.width * $1.height }), let rp = print_(ri, big) else {
  print("{\"error\":\"no face found in the reference\"}"); exit(3) }
for f in a.dropFirst(2) {
  guard let (fi, ff) = faces(f) else { print("{\"frame\":\"\(f)\",\"error\":\"cannot read\"}"); continue }
  var items: [String] = [], best = Float.greatestFiniteMagnitude
  for b in ff {
    guard let fp = print_(fi, b) else { continue }
    var d: Float = 0; try? rp.computeDistance(&d, to: fp); best = min(best, d)
    items.append("{\"box\":[\(String(format: "%.3f,%.3f,%.3f,%.3f", b.minX, 1 - b.maxY, b.width, b.height))],\"distance\":\(String(format: "%.3f", d))}")
  }
  print("{\"frame\":\"\(f)\",\"faces\":[\(items.joined(separator: ","))],\"best\":\(items.isEmpty ? "null" : String(format: "%.3f", best))}")
}
