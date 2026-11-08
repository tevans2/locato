import {Composition, Folder, Still} from 'remotion';
import {Avatar, Banner, HighlightCover} from './locato/brandkit';
import {FPS, H, W} from './locato/brand';
import {Quiz} from './locato/templates/Quiz';
import {Lookalikes} from './locato/templates/Lookalikes';
import {Clip} from './locato/templates/Clip';
import {Versus} from './locato/templates/Versus';
import {Leaderboard} from './locato/templates/Leaderboard';
import {boardDuration, clipDuration, lookDuration, quizDuration, versusDuration} from './locato/schema';

const frames = (s: number) => Math.ceil(s * FPS);
const sample = {src: 'locato/clips/sample-a.mp4', width: 1080, height: 1920, duration: 8};


// Locato templates: one composition each. A video is a JSON spec rendered with these props
// (see tools/locato/new.ts and tools/locato/render.mjs). The props below are only samples.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Locato">
        <Composition
          id="LocatoQuiz"
          component={Quiz}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={600}
          calculateMetadata={({props}) => ({durationInFrames: frames(quizDuration(props))})}
          defaultProps={{
            title: 'Name these 3 flags',
            badge: 'Medium',
            rounds: [
              {type: 'flag' as const, code: 'KE', country: 'Kenya', answer: 'Kenya', note: 'Africa'},
              {type: 'shape' as const, code: 'IT', country: 'Italy', answer: 'Italy', note: 'Europe'},
              {type: 'capital' as const, code: 'AU', country: 'Australia', answer: 'Canberra', note: 'Not Sydney!'},
            ],
            secondsPerRound: 3,
            outro: {question: 'How many did you get?'},
          }}
        />
        <Composition
          id="LocatoLookalikes"
          component={Lookalikes}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={600}
          calculateMetadata={({props}) => ({durationInFrames: frames(lookDuration(props))})}
          defaultProps={{
            title: 'Can you tell these apart?',
            badge: 'Look-alike flags',
            sets: [
              {skill: 'flag' as const, items: [{code: 'TD', name: 'Chad'}, {code: 'RO', name: 'Romania'}], tip: "Practically identical blue-yellow-red. Chad's blue is a darker indigo; Romania's is brighter."},
            ],
            secondsPerSet: 4,
            outro: {question: 'Did you get it?'},
          }}
        />
        <Composition
          id="LocatoClip"
          component={Clip}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={600}
          calculateMetadata={({props}) => ({durationInFrames: frames(clipDuration(props))})}
          defaultProps={{
            title: 'Every flag in Europe',
            badge: 'Speedrun',
            clip: sample,
            timer: {start: 0.5, stop: 7.2},
            callouts: [{at: 2, text: 'No hints used'}],
            zooms: [{start: 3, end: 6, x: 0.5, y: 0.4, scale: 1.4}],
            outro: {question: 'Can you beat it?'},
          }}
        />
        <Composition
          id="LocatoVersus"
          component={Versus}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={600}
          calculateMetadata={({props}) => ({durationInFrames: frames(versusDuration(props))})}
          defaultProps={{
            title: 'Flag race: who wins?',
            badge: '1v1',
            top: {name: 'Alex', emoji: '🌋', clip: {...sample}, result: '14 flags'},
            bottom: {name: 'Sam', emoji: '🗼', clip: {...sample, src: 'locato/clips/sample-b.mp4', duration: 7}, result: '11 flags'},
            winner: 'top' as const,
            outro: {question: 'Who would you beat?'},
          }}
        />
        <Composition
          id="LocatoLeaderboard"
          component={Leaderboard}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={600}
          calculateMetadata={({props}) => ({durationInFrames: frames(boardDuration(props))})}
          defaultProps={{
            title: 'Fastest to name every flag',
            badge: 'This week',
            metric: 'time' as const,
            entries: [
              {rank: 1, name: 'atlas_amy', emoji: '🌋', value: 269308},
              {rank: 2, name: 'mapnerd', emoji: '🗼', value: 273485},
              {rank: 3, name: 'kiwi', emoji: '🐨', value: 301002},
              {rank: 4, name: 'zoom', emoji: '🚀', value: 322110},
              {rank: 5, name: 'globetrot', emoji: '🧭', value: 340500},
            ],
            outro: {question: 'Could you make the top 5?'},
          }}
        />
      </Folder>
      <Folder name="Brand">
        <Still id="LocatoAvatar" component={Avatar} width={1080} height={1080} />
        <Still id="LocatoBanner" component={Banner} width={2560} height={1440} />
        <Still id="LocatoHighlight" component={HighlightCover} width={1080} height={1920} defaultProps={{label: 'Flags', code: 'jp'}} />
      </Folder>
    </>
  );
};
