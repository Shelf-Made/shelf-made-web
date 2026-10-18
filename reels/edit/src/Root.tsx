import React from "react";
import { Composition, Still } from "remotion";
import { Cover } from "./reel/Cover";
import { FPS, Reel, reelLength } from "./reel/Reel";
import { COVERS, REELS } from "./reels";
import { CozyCover } from "./cozy/CozyCover";
import { CozyReel, cozyLength, FPS as COZY_FPS } from "./cozy/CozyReel";
import { COZY_COVERS, COZY_REELS } from "./cozyReels";

/**
 * Every reel twice: with its (royalty-free) music baked in, and with game sound only, cut
 * to the same beat, for laying a trending track over it in Instagram's audio picker.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {Object.entries(REELS).map(([id, props]) => (
        <React.Fragment key={id}>
          <Composition
            id={id}
            component={Reel}
            fps={FPS}
            width={1080}
            height={1920}
            durationInFrames={reelLength(props)}
            defaultProps={props}
          />
          <Composition
            id={`${id}-game-sound`}
            component={Reel}
            fps={FPS}
            width={1080}
            height={1920}
            durationInFrames={reelLength(props)}
            defaultProps={{ ...props, music: null, gameVolume: 1 }}
          />
        </React.Fragment>
      ))}
      {Object.entries(COZY_REELS).map(([id, props]) => (
        <React.Fragment key={id}>
          <Composition id={id} component={CozyReel} fps={COZY_FPS} width={1080} height={1920} durationInFrames={cozyLength(props)} defaultProps={props} />
          <Composition id={`${id}-game-sound`} component={CozyReel} fps={COZY_FPS} width={1080} height={1920} durationInFrames={cozyLength(props)} defaultProps={{ ...props, music: null, gameVolume: 1 }} />
        </React.Fragment>
      ))}
      {Object.entries(COZY_COVERS).map(([id, props]) => (
        <Still key={id} id={id} component={CozyCover} width={1080} height={1920} defaultProps={props} />
      ))}
      {Object.entries(COVERS).map(([id, props]) => (
        <Still key={id} id={id} component={Cover} width={1080} height={1920} defaultProps={props} />
      ))}
    </>
  );
};
