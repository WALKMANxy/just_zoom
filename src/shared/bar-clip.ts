// The clip-path value the transform engine wrote on a video to reveal Ambience in baked-in bars.
// FrameSource reads it so its own clip doesn't make the picture look unmappable.
export const ownedClips = new WeakMap<HTMLVideoElement, string>();
