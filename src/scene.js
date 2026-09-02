/* ==========================================================================
   The world as a Phaser Scene, with Arcade physics doing the work.

   Unlike the other templates, the ball here is not integrated by hand: it is
   an Arcade body with gravity, bounce and world bounds, and Phaser resolves
   the floor collision and fires the event this scene listens for. That is the
   reason to pick Phaser, so the template leans on it rather than reimplementing
   it beside it.

   Every texture is generated in code -- no files are loaded, so the game makes
   no network request at all. The sandboxed WebView has no network, and the
   platform rules forbid the fetch APIs a loader would use.

   Nothing here knows about the SDK or scoring: it reports what happened
   through the callbacks handed to makeScene(), and main.js decides what that
   is worth.
   ========================================================================== */
import Phaser from 'phaser';

const GRAVITY = 2600;          // px/s^2 at unit scale 1
const RESTITUTION = 0.62;
const TAP_IMPULSE = 1150;
const HORIZON = 0.62;          // sky above, grass below

export function makeScene({ onTap, onBounce, onUpdate }) {
	return class BounceScene extends Phaser.Scene {
		constructor() { super('bounce'); }

		create() {
			this.unit = 1;
			this.ballRadius = 22;
			this.started = false;
			// The ball begins already at rest on the grass. Letting gravity run
			// before the first tap fires a floor collision -- sound and all --
			// before the player has touched anything.
			this.resting = true;

			this.sky = this.add.graphics();
			this.ground = this.add.graphics();
			this.blades = this.add.graphics();
			this.shadow = this.add.ellipse(0, 0, 10, 4, 0x0c3010, 0.34);

			this.clouds = [];
			for (let i = 0; i < 5; i++) {
				const g = this.add.graphics();
				g.fillStyle(0xffffff, 0.82);
				g.fillCircle(0, 0, 3.2);
				g.fillCircle(3.4, 0.5, 2.4);
				g.fillCircle(-3.1, 0.7, 2.1);
				this.clouds.push({ g, x: 0, y: 0, scale: 0.6 + Math.random() * 0.8, speed: 4 + Math.random() * 7, placed: false });
			}

			// A circle texture, so the ball can be a physics Image rather than a
			// Graphics the scene would have to move itself.
			const tex = this.add.graphics();
			tex.fillStyle(0xd6323f, 1).fillCircle(64, 64, 64);
			tex.fillStyle(0xfff1f1, 0.85).fillCircle(44, 41, 19);
			tex.lineStyle(10, 0xffffff, 0.9).beginPath().arc(64, 64, 40, -0.6, 1.5).strokePath();
			tex.generateTexture('ball', 128, 128);
			tex.destroy();

			this.ball = this.physics.add.image(0, 0, 'ball');
			this.ball.setCircle(64);
			this.ball.setBounce(RESTITUTION);
			this.ball.setCollideWorldBounds(true);
			this.ball.setDamping(true);
			this.ball.setDragX(0.6);
			// Phaser reports the collision instead of the scene testing for it.
			this.ball.body.setAllowGravity(false);
			this.ball.body.onWorldBounds = true;
			this.physics.world.on('worldbounds', (body, _up, down) => {
				if (body.gameObject !== this.ball || !down || this.resting) { return; }
				// The event fires after Arcade has already reflected the
				// velocity, so undo the restitution to recover the speed the
				// ball actually arrived at.
				const impact = Math.abs(body.velocity.y) / RESTITUTION;
				if (impact < this.settleSpeed()) { return; }   // see update()
				onBounce(impact / 1400);
			});

			this.particles = this.add.particles(0, 0, 'ball', {
				lifespan: 600, speed: { min: 60, max: 260 }, scale: { start: 0.03, end: 0 },
				alpha: { start: 1, end: 0 }, gravityY: 900, emitting: false,
			});

			this.scale.on('resize', () => this.layout());
			this.layout();

			// Pointer events cover touch and mouse from one path.
			this.input.on('pointerdown', (p) => this.tryHit(p.x, p.y));
		}

		layout() {
			const W = this.scale.width, H = this.scale.height;
			this.W = W; this.H = H;
			this.horizon = Math.round(H * HORIZON);
			// The short edge drives scale, so a tall narrow slot and a squat wide
			// one both get a ball that fits and reads at the same size.
			this.unit = Math.min(W, H * 0.62) / 100;
			this.ballRadius = Math.max(22, this.unit * 11);
			this.groundY = this.horizon - this.ballRadius * 0.35;

			// World bounds ARE the floor and the walls -- one call instead of a
			// hand-written clamp on each axis. The ceiling matters too: a tap
			// SETS upward velocity, so a rally climbs, and without a bound the
			// ball leaves the top of the screen where it cannot be tapped.
			//
			// The bounds are the range for the body's EDGES, not its centre, so
			// they run the full 0..groundY + radius. Insetting them by a radius
			// instead -- the obvious-looking thing -- stops the body's bottom at
			// groundY and leaves the ball hovering a whole radius above the
			// grass, which is exactly what it did.
			this.physics.world.setBounds(0, 0, W, this.groundY + this.ballRadius);
			this.physics.world.gravity.y = GRAVITY * (this.unit / 3.9);

			this.ball.setDisplaySize(this.ballRadius * 2, this.ballRadius * 2);
			this.ball.body.setCircle(64, 0, 0);
			if (!this.started) { this.ball.setPosition(W / 2, this.groundY); }

			this.sky.clear();
			this.sky.fillGradientStyle(0x1b4a8f, 0x1b4a8f, 0x9fd8ee, 0x9fd8ee, 1);
			this.sky.fillRect(0, 0, W, this.horizon);

			this.ground.clear();
			this.ground.fillGradientStyle(0x5fbf4a, 0x5fbf4a, 0x1f5c22, 0x1f5c22, 1);
			this.ground.fillRect(0, this.horizon, W, H - this.horizon);

			// Blades sit ON the horizon line, which is what sells it as a surface
			// the ball rests on rather than a colour change.
			this.blades.clear();
			const count = Math.round(W / 7);
			for (let i = 0; i < count; i++) {
				const x = Math.random() * W;
				const h = this.unit * (1.6 + Math.random() * 3.4);
				const lean = (Math.random() - 0.5) * 0.5;
				this.blades.lineStyle(Math.max(1, this.unit * 0.35), Math.random() > 0.5 ? 0x7ee060 : 0x2b782c, 0.9);
				this.blades.beginPath();
				this.blades.moveTo(x, this.horizon + this.unit * 0.5);
				this.blades.lineTo(x + lean * h * 1.8, this.horizon - h);
				this.blades.strokePath();
			}

			for (const c of this.clouds) {
				if (!c.placed) { c.x = Math.random() * W; c.y = this.horizon * (0.12 + Math.random() * 0.55); c.placed = true; }
				c.g.setScale(c.scale * this.unit);
			}
		}

		/* Below this arrival speed a landing is not a bounce, it is the ball
		   settling. Expressed as the velocity gravity restores in a tenth of a
		   second, so it scales with the world's gravity instead of being a
		   magic number that only holds at one frame rate. */
		settleSpeed() { return this.physics.world.gravity.y * 0.1; }

		tryHit(x, y) {
			// A fingertip is about 44 px and the ball is a moving target, so the
			// hit area is deliberately larger than the ball looks.
			const reach = Math.max(this.ballRadius * 1.45, 30);
			const dx = x - this.ball.x, dy = y - this.ball.y;
			if (dx * dx + dy * dy > reach * reach) { return false; }

			this.started = true;
			// Wake the body: it has gravity switched off while it rests.
			this.resting = false;
			this.ball.body.setAllowGravity(true);
			const scale = this.unit / 3.9;
			// Capped by the headroom left above the ball: low down it is the full
			// pop, near the top a small hop that keeps the ball hanging where it
			// is easiest to hit, so a rally can run as long as the player keeps up.
			const headroom = Math.max(0, this.ball.y - this.ballRadius * 1.2);
			const g = this.physics.world.gravity.y;
			this.ball.setVelocityY(-Math.min(TAP_IMPULSE * scale, Math.sqrt(2 * g * headroom)));
			this.ball.setVelocityX(this.ball.body.velocity.x + (dx / reach) * 320 * scale);
			this.particles.emitParticleAt(this.ball.x, this.ball.y + this.ballRadius * 0.3, 12);
			onTap();
			return true;
		}

		update(time, deltaMs) {
			const dt = Math.min(deltaMs / 1000, 1 / 20);

			/* Put the ball properly to sleep once it has settled, rather than
			   letting Arcade micro-bounce it forever. Gravity restores more
			   velocity every frame than a resting ball has, so without this the
			   floor collision re-fires continuously -- a constant impact sound
			   and a burst of grass on every frame. Switching gravity off is
			   frame-rate independent in a way that any velocity threshold on
			   its own is not. */
			if (!this.resting && this.ball.body.blocked.down
				&& Math.abs(this.ball.body.velocity.y) < this.settleSpeed()) {
				this.resting = true;
				this.ball.setVelocityY(0);
				this.ball.body.setAllowGravity(false);
			}
			for (const c of this.clouds) {
				c.x += c.speed * dt;
				if (c.x - 120 * c.scale > this.W) { c.x = -120 * c.scale; }
				c.g.setPosition(c.x, c.y);
			}

			// The shadow shrinks and fades as the ball climbs.
			const drop = Phaser.Math.Clamp((this.groundY - this.ball.y) / (this.H * 0.4), 0, 1);
			const r = this.ballRadius * (1.05 - drop * 0.4);
			this.shadow.setPosition(this.ball.x, this.groundY + this.ballRadius * 0.62);
			this.shadow.setSize(r * 2, r * 0.6);
			this.shadow.setDisplaySize(r * 2, r * 0.6);
			this.shadow.setAlpha(0.34 - drop * 0.22);

			// The absolute clock, not the per-frame delta. Phaser smooths delta
			// across frames, and accumulating a smoothed value drifts: a 30 s
			// round measured 31.9 s that way. Differencing `time` -- which is
			// Phaser's own game clock, and so still pauses when the page is
			// hidden -- does not.
			onUpdate(time, { x: this.ball.x, y: this.ball.y });
		}
	};
}
