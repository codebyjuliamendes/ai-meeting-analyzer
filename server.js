const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 4003;

app.use(express.static(path.join(__dirname, 'public')));

// The simulated meeting transcript
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

// Mock LLM Analysis logic
function analyzeTranscriptChunk(chunk) {
  let actionItem = null;
  let sentimentScore = 50; // Base neutral sentiment (0-100)

  // Hardcoded simple heuristics to mock the LLM
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
  
  // Sentiment adjustments
  if (chunk.text.includes('ridiculous') || chunk.text.includes('problem')) {
    sentimentScore = 20; // Tension!
  } else if (chunk.text.includes('Agreed') || chunk.text.includes('Thanks') || chunk.text.includes('No problem')) {
    sentimentScore = 80; // Positive resolution
  } else if (chunk.text.includes('kick off') || chunk.text.includes('Sounds good')) {
    sentimentScore = 60;
  }

  return {
    transcript: chunk,
    actionItem,
    sentiment: sentimentScore
  };
}

// SSE Endpoint
app.get('/api/stream-meeting', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  let index = 0;
  
  const intervalId = setInterval(() => {
    if (index < meetingTranscript.length) {
      const chunk = meetingTranscript[index];
      
      // Simulate LLM processing delay (500ms - 1000ms)
      setTimeout(() => {
        const analysis = analyzeTranscriptChunk(chunk);
        res.write(`data: ${JSON.stringify(analysis)}\n\n`);
      }, Math.random() * 500 + 500);

      index++;
    } else {
      clearInterval(intervalId);
      res.write('data: {"event": "END_OF_MEETING"}\n\n');
      res.end();
    }
  }, 3500); // Send new chunk every 3.5 seconds to give time to read

  req.on('close', () => {
    clearInterval(intervalId);
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
