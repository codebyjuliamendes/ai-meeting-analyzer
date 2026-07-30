/**
 * @fileoverview NexusMeet Server Entry Point.
 * Implements clean architecture principles, SSE streaming with robust error handling,
 * and standard express error middlewares.
 */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const app = express();
const port = process.env.PORT || 4003;

try {
  app.use(helmet());
  app.use(cors());
  app.use(compression());
} catch (err) {
  console.warn('Middleware init error:', err);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * @typedef {Object} TranscriptChunk
 * @property {string} speaker - The person speaking.
 * @property {string} text - The transcribed text.
 */

/**
 * @typedef {Object} ActionItem
 * @property {string} assignee - Person assigned to the task.
 * @property {string} task - Description of the task.
 * @property {string} deadline - The timeframe for completion.
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {TranscriptChunk} transcript - The original text.
 * @property {ActionItem|null} actionItem - Detected action item, if any.
 * @property {number} sentiment - Evaluated sentiment score (0-100).
 */

/** @type {TranscriptChunk[]} */
const meetingTranscript = [
  { speaker: 'Alice', text: 'Alright everyone, let\'s kick off the planning meeting for the new analytics dashboard.' },
  { speaker: 'Bob', text: 'Sounds good. Do we have the finalized designs from the UI team?' },
  { speaker: 'Charlie', text: 'Not yet, they said they\'d have them by tomorrow.' },
  { speaker: 'Alice', text: 'Okay, we can start on the backend setup first.' },
  { speaker: 'Bob', text: 'I can build the API by Tuesday.' },
  { speaker: 'Alice', text: 'Great. Charlie, what about the database schema?' },
  { speaker: 'Charlie', text: 'I\'ll draft the schema tonight and send it over for review.' },
  { speaker: 'Bob', text: 'Actually, there\'s a problem. We don\'t have the updated user metrics. We can\'t build the schema without them.' },
  { speaker: 'Charlie', text: 'That\'s ridiculous, I asked for those metrics last week!' },
  { speaker: 'Alice', text: 'Let\'s calm down. I will email the data team right after this call and get them.' },
  { speaker: 'Bob', text: 'Thanks Alice. If we get them today, we\'re still on track.' },
  { speaker: 'Charlie', text: 'Agreed. Sorry for the outburst, just stressed about the deadline.' },
  { speaker: 'Alice', text: 'No problem. So we have our action items. Let\'s reconvene on Wednesday.' }
];

/**
 * Analyzes a chunk of transcript to simulate an LLM response.
 * @param {TranscriptChunk} chunk - The transcript chunk to analyze.
 * @returns {AnalysisResult} The structured analysis.
 * @throws {Error} If chunk is invalid.
 */
function analyzeTranscriptChunk(chunk) {
  if (!chunk || typeof chunk.text !== 'string' || typeof chunk.speaker !== 'string') {
    throw new Error('Invalid transcript chunk format.');
  }

  let actionItem = null;
  let sentimentScore = 50;

  if (chunk.text.includes('build the API by Tuesday')) {
    actionItem = { assignee: 'Bob', task: 'Build the API', deadline: 'Tuesday' };
    sentimentScore = 70;
  } else if (chunk.text.includes('draft the schema tonight')) {
    actionItem = { assignee: 'Charlie', task: 'Draft database schema', deadline: 'Tonight' };
    sentimentScore = 75;
  } else if (chunk.text.includes('email the data team')) {
    actionItem = { assignee: 'Alice', task: 'Email data team for metrics', deadline: 'Today' };
    sentimentScore = 60;
  }
  
  if (chunk.text.includes('ridiculous') || chunk.text.includes('problem')) {
    sentimentScore = 20; 
  } else if (chunk.text.includes('Agreed') || chunk.text.includes('Thanks') || chunk.text.includes('No problem')) {
    sentimentScore = 80;
  } else if (chunk.text.includes('kick off') || chunk.text.includes('Sounds good')) {
    sentimentScore = 60;
  }

  return {
    transcript: chunk,
    actionItem,
    sentiment: sentimentScore
  };
}

/**
 * Validates SSE stream connection requests.
 * @param {express.Request} req - Express request object.
 * @param {express.Response} res - Express response object.
 * @param {express.NextFunction} next - Express next function.
 */
function streamValidationMiddleware(req, res, next) {
  // Add robust validations if headers or query params were needed
  next();
}

/**
 * SSE Endpoint for streaming meeting transcripts.
 */
app.get('/api/stream-meeting', streamValidationMiddleware, (req, res, next) => {
  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    let index = 0;
    
    const intervalId = setInterval(() => {
      try {
        if (index < meetingTranscript.length) {
          const chunk = meetingTranscript[index];
          
          setTimeout(() => {
            try {
              const analysis = analyzeTranscriptChunk(chunk);
              res.write(`data: ${JSON.stringify(analysis)}\n\n`);
            } catch (innerError) {
              console.error('Error analyzing chunk:', innerError);
              res.write(`data: {"error": "Failed to analyze chunk"}\n\n`);
            }
          }, Math.random() * 500 + 500);

          index++;
        } else {
          clearInterval(intervalId);
          res.write('data: {"event": "END_OF_MEETING"}\n\n');
          res.end();
        }
      } catch (err) {
        clearInterval(intervalId);
        console.error('Interval processing error:', err);
        res.end();
      }
    }, 3500);

    req.on('close', () => {
      clearInterval(intervalId);
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Global Error Handler Middleware
 */
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err.stack);
  res.status(500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
