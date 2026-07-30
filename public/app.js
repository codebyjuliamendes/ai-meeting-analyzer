document.addEventListener('DOMContentLoaded', () => {
  // --- UI Elements ---
  const transcriptContainer = document.getElementById('transcript-container');
  const todoContainer = document.querySelector('#col-todo .cards-container');
  const videoBoxes = {
    Alice: document.getElementById('video-alice'),
    Bob: document.getElementById('video-bob'),
    Charlie: document.getElementById('video-charlie')
  };

  // --- Chart Setup ---
  const ctx = document.getElementById('sentimentChart').getContext('2d');
  
  // Gradient for chart line
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, 'rgba(46, 160, 67, 0.5)'); // Green (Success)
  gradient.addColorStop(1, 'rgba(248, 81, 73, 0.5)'); // Red (Danger)

  const sentimentData = {
    labels: ['Start'],
    datasets: [{
      label: 'Team Mood',
      data: [50],
      borderColor: '#58a6ff',
      backgroundColor: gradient,
      borderWidth: 2,
      pointBackgroundColor: '#fff',
      pointRadius: 4,
      fill: true,
      tension: 0.4
    }]
  };

  const sentimentChart = new Chart(ctx, {
    type: 'line',
    data: sentimentData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: 'rgba(255, 255, 255, 0.5)' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      animation: {
        duration: 800,
        easing: 'easeOutQuart'
      }
    }
  });

  // --- Helpers ---
  function updateSpeakerHighlight(speaker) {
    Object.values(videoBoxes).forEach(box => box.classList.remove('speaking'));
    if (videoBoxes[speaker]) {
      videoBoxes[speaker].classList.add('speaking');
    }
  }

  function appendTranscript(msg) {
    // Remove waiting text if present
    const waiting = document.querySelector('.waiting-text');
    if (waiting) waiting.remove();

    const div = document.createElement('div');
    div.className = `transcript-msg ${msg.speaker}`;
    div.innerHTML = `
      <div class="msg-header">${msg.speaker}</div>
      <div class="msg-text">${msg.text}</div>
    `;
    transcriptContainer.appendChild(div);
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
  }

  function createActionItem(item) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.innerHTML = `
      <div class="card-title">${item.task}</div>
      <div class="card-meta">
        <span class="assignee">@${item.assignee}</span>
        <span class="deadline">🎯 ${item.deadline}</span>
      </div>
    `;
    todoContainer.appendChild(card);
  }

  function updateChart(sentimentScore) {
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    sentimentChart.data.labels.push(timeLabel);
    sentimentChart.data.datasets[0].data.push(sentimentScore);
    
    // Change line color based on sentiment dynamically
    if (sentimentScore < 40) {
      sentimentChart.data.datasets[0].borderColor = '#f85149'; // Red
    } else if (sentimentScore > 70) {
      sentimentChart.data.datasets[0].borderColor = '#2ea043'; // Green
    } else {
      sentimentChart.data.datasets[0].borderColor = '#58a6ff'; // Blue
    }

    // Keep last 10 points max
    if (sentimentChart.data.labels.length > 8) {
      sentimentChart.data.labels.shift();
      sentimentChart.data.datasets[0].data.shift();
    }
    
    sentimentChart.update();
  }

  // --- SSE Connection ---
  const eventSource = new EventSource('/api/stream-meeting');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.event === 'END_OF_MEETING') {
      eventSource.close();
      document.querySelector('.status-indicator').innerHTML = 'Meeting Ended';
      document.querySelector('.status-indicator').style.color = '#8b949e';
      document.querySelector('.status-indicator').style.background = 'rgba(255,255,255,0.1)';
      Object.values(videoBoxes).forEach(box => box.classList.remove('speaking'));
      return;
    }

    // 1. Highlight Speaker
    updateSpeakerHighlight(data.transcript.speaker);

    // 2. Add Transcript
    appendTranscript(data.transcript);

    // 3. Check for Action Items
    if (data.actionItem) {
      createActionItem(data.actionItem);
    }

    // 4. Update Sentiment Graph
    updateChart(data.sentiment);
  };

  eventSource.onerror = (err) => {
    console.error('SSE Error:', err);
    eventSource.close();
  };
});
