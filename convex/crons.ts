import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Hourly tick: send any digest whose local send time has just arrived. The
// per-digest schedule/timezone decide whether each one fires (see email.tick).
crons.interval('send scheduled digests', { hours: 1 }, internal.email.tick, {})

export default crons
