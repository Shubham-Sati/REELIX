// REELIX subject cut-out with Apple Vision (macOS 14+, offline, free).
// Usage: cutout <in.png> <out.png> [--largest]
// Writes a transparent PNG the same size as the input (so the layer lines up with its background).
import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins

let a = CommandLine.arguments
guard a.count >= 3 else { print("usage: cutout <in.png> <out.png> [--largest]"); exit(2) }
let largest = a.contains("--largest")
guard let img = CIImage(contentsOf: URL(fileURLWithPath: a[1])) else { print("cannot read \(a[1])"); exit(1) }
let req = VNGenerateForegroundInstanceMaskRequest()
let h = VNImageRequestHandler(ciImage: img)
do { try h.perform([req]) } catch { print("vision failed: \(error)"); exit(1) }
guard let r = req.results?.first, !r.allInstances.isEmpty else { print("{\"subjects\":0}"); exit(3) }
var keep = r.allInstances
if largest && keep.count > 1 {
  // pick the instance with the most mask pixels
  var best = keep.first!, bestN = -1
  for i in keep {
    guard let m = try? r.generateScaledMaskForImage(forInstances: [i], from: h) else { continue }
    CVPixelBufferLockBaseAddress(m, .readOnly)
    let w = CVPixelBufferGetWidth(m), hh = CVPixelBufferGetHeight(m), row = CVPixelBufferGetBytesPerRow(m)
    let p = CVPixelBufferGetBaseAddress(m)!.assumingMemoryBound(to: Float32.self)
    var n = 0
    for y in stride(from: 0, to: hh, by: 4) { for x in stride(from: 0, to: w, by: 4) { if p[y * row / 4 + x] > 0.5 { n += 1 } } }
    CVPixelBufferUnlockBaseAddress(m, .readOnly)
    if n > bestN { bestN = n; best = i }
  }
  keep = IndexSet(integer: best)
}
guard let mask = try? r.generateScaledMaskForImage(forInstances: keep, from: h) else { print("mask failed"); exit(1) }
let f = CIFilter.blendWithMask()
f.inputImage = img; f.backgroundImage = CIImage.empty().cropped(to: img.extent); f.maskImage = CIImage(cvPixelBuffer: mask)
let ctx = CIContext()
guard let out = f.outputImage, let cs = CGColorSpace(name: CGColorSpace.sRGB) else { exit(1) }
do { try ctx.writePNGRepresentation(of: out, to: URL(fileURLWithPath: a[2]), format: .RGBA8, colorSpace: cs) } catch { print("write failed: \(error)"); exit(1) }
print("{\"subjects\":\(r.allInstances.count),\"kept\":\(keep.count)}")
