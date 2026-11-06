import React from 'react';
import {Composition} from 'remotion';
import {SeuChatSeguroTour, SeuChatSeguroTourMobile, TOUR_DURATION, TOUR_FPS, TOUR_HEIGHT, TOUR_WIDTH} from './Tour';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="SeuChatSeguroTour"
      component={SeuChatSeguroTour}
      durationInFrames={TOUR_DURATION}
      fps={TOUR_FPS}
      width={TOUR_WIDTH}
      height={TOUR_HEIGHT}
    />
    <Composition
      id="SeuChatSeguroTourMobile"
      component={SeuChatSeguroTourMobile}
      durationInFrames={TOUR_DURATION}
      fps={TOUR_FPS}
      width={TOUR_WIDTH}
      height={TOUR_HEIGHT}
    />
  </>
);
