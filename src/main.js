/* ==========================================================================
   Lifecycle and scoring -- the part of the template worth copying.

   The host wraps every game in the same three-call contract:

     initializeSDK()   once, at startup
     loadingDone()     once the first interactive frame is on screen
     reportResult()    once, when the run ends

   A Minit drop is one session: load, play, result. No title screen, no "tap to
   begin", no replay menu -- the host owns both ends.

   Phaser runs its own loop, so the clock and the HUD hang off the scene's
   update rather than a requestAnimationFrame of their own.
   ========================================================================== */
import Phaser from 'phaser';
import { initializeSDK, getConfigValue, reportResult, loadingDone } from '@minit-games/sdk';
import {
	createHeaderBar, showPositiveFeedback, showNeutralFeedback, preloadFeedbackFont,
	spawnRewards, shouldShowTutorial, createTutorialOverlay,
} from '@minit-games/sdk/ui';

import { makeScene } from './scene.js';
import { createAudio } from './audio.js';

initializeSDK();

/* ---- config ----------------------------------------------------------
   Config values always arrive as strings -- the host appends every declared
   key to the game URL. Coerce, and keep a default so `npm run dev` and a
   direct URL still work. The keys are declared in public/meta.json. */
const POINTS_PER_TAP = Math.max(1, Number(getConfigValue('pointsPerTap', '10')) || 10);
const SOUND_ON = getConfigValue('sound', 'true') === 'true';
const MUSIC_ON = getConfigValue('music', 'true') === 'true';

/* How long a run lasts. The host owns everything either side of the run, so
   the game ends itself on a clock rather than offering a button to press. */
const ROUND_SECONDS = 30;

const audio = createAudio({ sound: SOUND_ON, music: MUSIC_ON });

let score = 0;
let rally = 0;          // taps since the ball last touched the grass
let bestRally = 0;
let bounces = 0;
let finished = false;
let remaining = ROUND_SECONDS;
let shownSecond = ROUND_SECONDS;
let ready = false;
let lastTime = 0;
let game = null;

/* ---- HUD -------------------------------------------------------------
   Layout only: Score on the right, secondary stats on the left. The SDK ships
   the styling and it is meant to look the same across drops. */
const header = createHeaderBar({ y: 28, padding: 22 });
const timePanel = header.addPanel({ label: 'Time', value: ROUND_SECONDS });
const scorePanel = header.addPanel({ label: 'Score', value: 0, align: 'right' });

preloadFeedbackFont();

let tutorial = null;
let finger = null;

function endGame() {
	if (finished) { return; }
	finished = true;
	timePanel.setValue(0);
	audio.finish();

	// flavorText is a session moment rendered by the host beneath the score --
	// never the score again, and never drawn in-game.
	const flavorText = bestRally >= 3
		? `Best rally: ${bestRally} taps without a bounce`
		: `${bounces} bounce${bounces === 1 ? '' : 's'} off the grass`;

	reportResult(score, { flavorText, userData: 'played' });
	// The host overlays its result screen and takes focus, so there is nothing
	// left worth simulating.
	game?.scene.pause('bounce');
}

const Scene = makeScene({
	onTap() {
		// The gesture that reaches the scene is also the one that unlocks audio:
		// a context resumed outside a gesture stays suspended, and everything
		// played into it is discarded rather than queued.
		audio.unlock();
		if (finished) { return; }

		rally++;
		if (rally > bestRally) { bestRally = rally; }
		audio.tap();

		if (rally === 3) { showPositiveFeedback('Rally x3!'); }
		else if (rally === 6) { showPositiveFeedback('Rally x6!'); }
		else if (rally >= 10 && rally % 5 === 0) { showPositiveFeedback(`Rally x${rally}!`); }
	},

	onBounce(strength) {
		// A settling ball produces a long tail of ever-smaller bounces; counting
		// all of them makes the end-of-run stat meaningless.
		if (strength > 0.12) { bounces++; }
		audio.bounce();
		if (rally >= 3) { showNeutralFeedback('Rally Lost'); }
		rally = 0;
	},

	onUpdate(time, ballAt) {
		if (!ready) {
			ready = true;
			lastTime = time;
			// The app holds a loading screen over the WebView until this fires,
			// so it goes as soon as there is a real frame.
			loadingDone();
		}
		if (finished) { return; }

		// Differenced from Phaser's own clock, and clamped only to absorb the
		// jump after a background. The physics clamp is a separate, tighter one
		// inside the scene; sharing it here would donate every slow frame back
		// to the player.
		const raw = (time - lastTime) / 1000;
		lastTime = time;
		remaining -= Math.min(raw, 0.5);
		const whole = Math.max(0, Math.ceil(remaining));
		if (whole !== shownSecond) {
			shownSecond = whole;
			timePanel.setValue(whole);
			if (whole === 10) { showNeutralFeedback('10s Left!'); }
		}
		if (remaining <= 0) { endGame(); }
		if (finger) { finger.setPosition(ballAt.x, ballAt.y + 40); }
	},
});

/* Scoring lives here rather than in the scene so the scene stays a renderer.
   One flying icon per point, not one per scoring event -- spawnRewards
   clusters big payouts so the HUD stays readable, and the score only moves
   when the icons land. */
const scored = (at) => spawnRewards(POINTS_PER_TAP, {
	start: at,
	target: scorePanel.getPosition(),
	onAllArrive: () => {
		score += POINTS_PER_TAP;
		scorePanel.setValue(score, { animate: true });
	},
});

game = new Phaser.Game({
	type: Phaser.AUTO,
	parent: 'game',
	// RESIZE, because the slot's shape is the host's to decide and can change
	// under the game at any moment.
	scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
	physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
	// Phaser smooths delta by default; the clock differences `time` instead, so
	// turn it off rather than leave two notions of elapsed time disagreeing.
	fps: { smoothStep: false },
	backgroundColor: '#1b4a8f',
	scene: [Scene],
});

// Bridge the scene's tap into the reward animation, which needs the HUD.
game.events.on('ready', () => {
	const scene = game.scene.getScene('bounce');
	scene.input.on('pointerdown', (p) => {
		if (!finished && Phaser.Math.Distance.Between(p.x, p.y, scene.ball.x, scene.ball.y)
			<= Math.max(scene.ballRadius * 1.45, 30)) {
			scored({ x: scene.ball.x, y: scene.ball.y });
		}
	});

	/* Gated by the host's userData: a returning player has a value stored and
	   never sees it again. Gesture over text. */
	if (shouldShowTutorial()) {
		tutorial = createTutorialOverlay({ container: document.body });
		finger = tutorial.showFinger({ x: scene.ball.x, y: scene.ball.y + 40 });
		scene.input.once('pointerdown', () => {
			if (tutorial) { tutorial.destroy(); tutorial = null; finger = null; }
		});
	}
});
