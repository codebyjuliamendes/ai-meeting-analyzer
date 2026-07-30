document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

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
      borderColor: '#3b82f6', // blue-500
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
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const iconName = type === 'success' ? 'check-circle' : (type === 'info' ? 'info' : 'alert-circle');
    const iconColor = type === 'success' ? 'text-emerald-400' : (type === 'info' ? 'text-blue-400' : 'text-red-400');
    
    toast.className = 'glass-panel p-3 rounded-lg border border-slate-700/50 flex items-center gap-3 shadow-lg transform transition-all duration-300 translate-x-full opacity-0';
    toast.innerHTML = `
      <i data-lucide="${iconName}" class="w-5 h-5 ${iconColor}"></i>
      <span class="text-sm font-medium text-slate-200">${message}</span>
    `;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons({ root: toast });
    
    requestAnimationFrame(() => {
      toast.classList.remove('translate-x-full', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('translate-x-full', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
  function updateSpeakerHighlight(speaker) {
    Object.values(videoBoxes).forEach(box => {
      box.classList.remove('speaking-glow', 'scale-105', 'border-brand');
      box.classList.add('border-transparent');
    });
    if (videoBoxes[speaker]) {
      videoBoxes[speaker].classList.remove('border-transparent');
      videoBoxes[speaker].classList.add('speaking-glow', 'scale-105', 'border-brand');
    }
  }

  function getSpeakerColor(speaker) {
    const colors = {
      Alice: 'text-indigo-400',
      Bob: 'text-blue-400',
      Charlie: 'text-emerald-400'
    };
    return colors[speaker] || 'text-slate-400';
  }

  function appendTranscript(msg) {
    // Remove waiting text if present
    const waiting = document.querySelector('.waiting-text');
    if (waiting) waiting.remove();

    const div = document.createElement('div');
    div.className = 'bg-slate-800/60 p-3 rounded-xl border border-slate-700/50 transform transition-all duration-300 translate-y-2 opacity-0 shadow-sm';
    
    // Slight delay to trigger animation
    setTimeout(() => {
      div.classList.remove('translate-y-2', 'opacity-0');
    }, 50);

    const speakerColor = getSpeakerColor(msg.speaker);

    div.innerHTML = `
      <div class="text-xs font-bold ${speakerColor} mb-1 tracking-wide uppercase">${msg.speaker}</div>
      <div class="text-sm text-slate-300 leading-relaxed">${msg.text}</div>
    `;
    transcriptContainer.appendChild(div);
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
  }

  function createActionItem(item) {
    const card = document.createElement('div');
    card.className = 'bg-slate-700/50 hover:bg-slate-700 p-3 rounded-lg border border-slate-600/50 shadow-sm transition-colors duration-200 group';
    card.innerHTML = `
      <div class="text-sm font-medium text-slate-200 mb-2 group-hover:text-white transition-colors">${item.task}</div>
      <div class="flex items-center justify-between text-xs">
        <span class="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30 font-medium">@${item.assignee}</span>
        <span class="text-amber-400/90 flex items-center gap-1 font-medium"><i data-lucide="clock" class="w-3 h-3"></i> ${item.deadline}</span>
      </div>
    `;
    todoContainer.appendChild(card);
    if (window.lucide) lucide.createIcons({ root: card });
    showToast(`New task assigned to ${item.assignee}`, 'success');
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
      sentimentChart.data.datasets[0].borderColor = '#3b82f6'; // Blue
    }

    // Keep last 10 points max
    if (sentimentChart.data.labels.length > 8) {
      sentimentChart.data.labels.shift();
      sentimentChart.data.datasets[0].data.shift();
    }
    
    sentimentChart.update();
  }

  // --- SSE Connection ---
  let eventSource = null;

  function connectSSE() {
    eventSource = new EventSource('/api/stream-meeting');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.event === 'END_OF_MEETING') {
        eventSource.close();
        
        const statusInd = document.querySelector('.status-indicator');
        statusInd.className = 'flex items-center gap-3 bg-slate-800/80 px-4 py-1.5 rounded-full border border-slate-700/50 status-indicator';
        statusInd.innerHTML = '<span class="text-sm font-medium text-slate-400 status-text">Meeting Ended</span>';
        
        Object.values(videoBoxes).forEach(box => {
          box.classList.remove('speaking-glow', 'scale-105', 'border-brand');
          box.classList.add('border-transparent');
        });
        showToast('Meeting stream ended', 'info');
        return;
      }

      if (data.error) {
        console.error('Server error:', data.error);
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
      
      const statusInd = document.querySelector('.status-indicator');
      statusInd.innerHTML = '<span class="text-sm font-medium text-red-400 status-text">Connection Lost</span>';
      showToast('Connection lost', 'error');
    };
  }

  showToast('Connecting to NexusMeet stream...', 'info');
  connectSSE();
});
