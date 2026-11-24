import { generateTownSync } from './pipeline';
import { TownParams } from '../model/types';

self.onmessage = (ev: MessageEvent<{ params: TownParams }>) => {
  const { params } = ev.data;
  const town = generateTownSync(params, (stageLabel, percent) => {
    self.postMessage({ type: 'progress', stageLabel, percent });
  });
  self.postMessage({ type: 'done', town });
};
