(function(){
  'use strict';

  // ============ STATE ============
  // Admin key is held only in memory (a plain JS variable), never written
  // to localStorage/sessionStorage/cookies. Reloading the page requires
  // logging in again — a deliberate tradeoff for not leaving a credential
  // sitting in browser storage. See the login screen's own note to the user.
  var state = {
    apiBase: '',
    adminKey: '',
    stories: [],
    resources: [],
    impactMetrics: []
  };

  // ============ DOM HELPERS ============
  function $(id){ return document.getElementById(id); }
  function escapeHtml(str){
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ============ API ============
  function apiCall(method, path, body){
    var opts = {
      method: method,
      headers: {
        'x-admin-key': state.adminKey,
        'Content-Type': 'application/json'
      }
    };
    if(body !== undefined) opts.body = JSON.stringify(body);

    return fetch(state.apiBase + path, opts)
      .then(function(res){
        return res.json().then(function(data){
          return { status: res.status, data: data };
        }).catch(function(){
          // Response wasn't valid JSON at all — surface a clear error
          // rather than letting a cryptic parse failure propagate.
          return { status: res.status, data: { ok: false, errors: ['Server returned an unexpected response (status ' + res.status + ').'] } };
        });
      });
  }

  // ============ LOGIN ============
  function attemptLogin(){
    var apiBase = $('apiBaseInput').value.trim().replace(/\/+$/, ''); // strip trailing slash
    var adminKey = $('adminKeyInput').value.trim();
    var errorEl = $('loginError');
    errorEl.textContent = '';

    if(!apiBase || !/^https?:\/\//i.test(apiBase)){
      errorEl.textContent = 'Enter a valid backend address starting with http:// or https://';
      return;
    }
    if(!adminKey){
      errorEl.textContent = 'Enter your admin key.';
      return;
    }

    var loginBtn = $('loginBtn');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Checking…';

    state.apiBase = apiBase;
    state.adminKey = adminKey;

    // Verify the key actually works before showing the dashboard, using
    // a lightweight real request rather than just trusting the input.
    apiCall('GET', '/admin/stories').then(function(result){
      loginBtn.disabled = false;
      loginBtn.textContent = 'Log in';

      if(result.status === 401){
        errorEl.textContent = 'That admin key was rejected. Check it and try again.';
        state.adminKey = '';
        return;
      }
      if(result.status === 503){
        errorEl.textContent = 'The backend has no ADMIN_API_KEY configured yet — set one in its environment variables.';
        return;
      }
      if(!result.data.ok && result.status !== 500){
        // 500 here likely means Supabase isn't configured yet on the
        // backend, which is a real, distinct situation from a bad key —
        // the key worked (we got past auth), so let the user in and show
        // the underlying error inside the dashboard instead.
        errorEl.textContent = (result.data.errors && result.data.errors[0]) || 'Could not log in.';
        return;
      }

      showDashboard();
    }).catch(function(err){
      loginBtn.disabled = false;
      loginBtn.textContent = 'Log in';
      errorEl.textContent = 'Could not reach that backend address. Check the URL and that the server is running.';
    });
  }

  function logout(){
    state.adminKey = '';
    state.apiBase = '';
    $('dashboard').style.display = 'none';
    $('loginScreen').style.display = 'flex';
    $('adminKeyInput').value = '';
    $('loginError').textContent = '';
  }

  function showDashboard(){
    $('loginScreen').style.display = 'none';
    $('dashboard').style.display = 'block';
    loadStories();
    loadResources();
    loadImpactMetrics();
    loadSubmissions();
  }

  // ============ TABS ============
  function setupTabs(){
    var tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function(btn){
      btn.addEventListener('click', function(){
        tabBtns.forEach(function(b){ b.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
        btn.classList.add('active');
        $('panel-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ============ STORIES ============
  function loadStories(){
    var list = $('storiesList');
    list.innerHTML = '<p class="loading-state">Loading stories…</p>';
    apiCall('GET', '/admin/stories').then(function(result){
      if(!result.data.ok){
        list.innerHTML = '<div class="error-state">' + escapeHtml((result.data.errors || ['Failed to load stories.'])[0]) + '</div>';
        return;
      }
      state.stories = result.data.stories;
      renderStories();
    }).catch(function(){
      list.innerHTML = '<div class="error-state">Could not reach the backend.</div>';
    });
  }

  function renderStories(){
    var list = $('storiesList');
    if(state.stories.length === 0){
      list.innerHTML = '<p class="empty-state">No stories yet. Click "+ New story" to add one.</p>';
      return;
    }
    list.innerHTML = state.stories.map(function(s){
      var publishedBadge = s.published
        ? '<span class="badge-pill badge-published">Published</span>'
        : '<span class="badge-pill badge-draft">Draft</span>';
      var consentBadge = !s.consent_confirmed
        ? '<span class="badge-pill badge-noconsent">Consent not confirmed</span>'
        : '';
      return '' +
        '<div class="item-card">' +
          '<div class="item-card-main">' +
            '<div class="item-card-title">' + escapeHtml(s.title) + '</div>' +
            '<div class="item-card-meta">' +
              '<span>' + escapeHtml(s.tag) + '</span>' +
              '<span>/' + escapeHtml(s.slug) + '</span>' +
              publishedBadge + consentBadge +
            '</div>' +
          '</div>' +
          '<div class="item-card-actions">' +
            '<button class="btn-sm" data-edit-story="' + escapeHtml(s.id) + '">Edit</button>' +
            '<button class="btn-sm danger" data-delete-story="' + escapeHtml(s.id) + '">Delete</button>' +
          '</div>' +
        '</div>';
    }).join('');

    list.querySelectorAll('[data-edit-story]').forEach(function(btn){
      btn.addEventListener('click', function(){ openStoryModal(btn.dataset.editStory); });
    });
    list.querySelectorAll('[data-delete-story]').forEach(function(btn){
      btn.addEventListener('click', function(){ confirmDeleteStory(btn.dataset.deleteStory); });
    });
  }

  var editingStoryId = null;

  function openStoryModal(storyId){
    editingStoryId = storyId || null;
    var story = storyId ? state.stories.find(function(s){ return s.id === storyId; }) : null;

    $('storyModalTitle').textContent = story ? 'Edit story' : 'New story';
    $('storySlug').value = story ? story.slug : '';
    $('storyTag').value = story ? story.tag : '';
    $('storyTitle').value = story ? story.title : '';
    $('storySummary').value = story && story.summary ? story.summary : '';
    $('storyBody').value = story ? story.body : '';
    $('storyConsent').checked = story ? !!story.consent_confirmed : false;
    $('storyPublished').checked = story ? !!story.published : false;
    $('storyModalError').textContent = '';
    $('storyModal').style.display = 'flex';
  }

  function closeStoryModal(){
    $('storyModal').style.display = 'none';
    editingStoryId = null;
  }

  function saveStory(){
    var errorEl = $('storyModalError');
    errorEl.textContent = '';

    var published = $('storyPublished').checked;
    var consent = $('storyConsent').checked;

    // Client-side mirror of the backend's own guardrail — this is a UX
    // convenience (fail fast, no round trip) and NOT the real enforcement.
    // The backend re-checks this independently in routes/admin.js and
    // will reject the request regardless of what this check does.
    if(published && !consent){
      errorEl.textContent = 'Cannot publish while "Consent confirmed" is unchecked.';
      return;
    }

    var payload = {
      slug: $('storySlug').value.trim(),
      tag: $('storyTag').value.trim(),
      title: $('storyTitle').value.trim(),
      summary: $('storySummary').value.trim(),
      body: $('storyBody').value,
      consent_confirmed: consent,
      published: published
    };

    var saveBtn = $('storyModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    var request = editingStoryId
      ? apiCall('PATCH', '/admin/stories/' + encodeURIComponent(editingStoryId), payload)
      : apiCall('POST', '/admin/stories', payload);

    request.then(function(result){
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      if(!result.data.ok){
        errorEl.textContent = (result.data.errors && result.data.errors[0]) || 'Failed to save story.';
        return;
      }
      closeStoryModal();
      loadStories();
    }).catch(function(){
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      errorEl.textContent = 'Could not reach the backend.';
    });
  }

  var pendingDelete = null;

  function confirmDeleteStory(storyId){
    pendingDelete = { type: 'story', id: storyId };
    $('confirmModalText').textContent = 'This story will be permanently deleted. This cannot be undone.';
    $('confirmModal').style.display = 'flex';
  }

  // ============ RESOURCES ============
  function loadResources(){
    var list = $('resourcesList');
    list.innerHTML = '<p class="loading-state">Loading resources…</p>';
    apiCall('GET', '/admin/resources').then(function(result){
      if(!result.data.ok){
        list.innerHTML = '<div class="error-state">' + escapeHtml((result.data.errors || ['Failed to load resources.'])[0]) + '</div>';
        return;
      }
      state.resources = result.data.resources;
      renderResources();
    }).catch(function(){
      list.innerHTML = '<div class="error-state">Could not reach the backend.</div>';
    });
  }

  function renderResources(){
    var list = $('resourcesList');
    if(state.resources.length === 0){
      list.innerHTML = '<p class="empty-state">No resources yet. Click "+ New resource" to add one.</p>';
      return;
    }
    list.innerHTML = state.resources.map(function(r){
      var publishedBadge = r.published
        ? '<span class="badge-pill badge-published">Published</span>'
        : '<span class="badge-pill badge-draft">Draft</span>';
      return '' +
        '<div class="item-card">' +
          '<div class="item-card-main">' +
            '<div class="item-card-title">' + escapeHtml(r.title) + '</div>' +
            '<div class="item-card-meta">' +
              '<span>' + escapeHtml(r.category) + '</span>' +
              '<span>' + escapeHtml(r.format) + '</span>' +
              (r.age_range ? '<span>' + escapeHtml(r.age_range) + '</span>' : '') +
              publishedBadge +
            '</div>' +
          '</div>' +
          '<div class="item-card-actions">' +
            '<button class="btn-sm" data-edit-resource="' + escapeHtml(r.id) + '">Edit</button>' +
            '<button class="btn-sm danger" data-delete-resource="' + escapeHtml(r.id) + '">Delete</button>' +
          '</div>' +
        '</div>';
    }).join('');

    list.querySelectorAll('[data-edit-resource]').forEach(function(btn){
      btn.addEventListener('click', function(){ openResourceModal(btn.dataset.editResource); });
    });
    list.querySelectorAll('[data-delete-resource]').forEach(function(btn){
      btn.addEventListener('click', function(){ confirmDeleteResource(btn.dataset.deleteResource); });
    });
  }

  var editingResourceId = null;

  function openResourceModal(resourceId){
    editingResourceId = resourceId || null;
    var resource = resourceId ? state.resources.find(function(r){ return r.id === resourceId; }) : null;

    $('resourceModalTitle').textContent = resource ? 'Edit resource' : 'New resource';
    $('resourceTitle').value = resource ? resource.title : '';
    $('resourceCategory').value = resource ? resource.category : 'Curriculum';
    $('resourceFormat').value = resource ? resource.format : '';
    $('resourceAgeRange').value = resource && resource.age_range ? resource.age_range : '';
    $('resourceFileUrl').value = resource && resource.file_url ? resource.file_url : '';
    $('resourcePublished').checked = resource ? !!resource.published : false;
    $('resourceModalError').textContent = '';
    $('resourceModal').style.display = 'flex';
  }

  function closeResourceModal(){
    $('resourceModal').style.display = 'none';
    editingResourceId = null;
  }

  function saveResource(){
    var errorEl = $('resourceModalError');
    errorEl.textContent = '';

    var fileUrl = $('resourceFileUrl').value.trim();
    if(fileUrl && !/^https?:\/\//i.test(fileUrl)){
      errorEl.textContent = 'File URL must start with http:// or https://';
      return;
    }

    var payload = {
      title: $('resourceTitle').value.trim(),
      category: $('resourceCategory').value,
      format: $('resourceFormat').value.trim(),
      age_range: $('resourceAgeRange').value.trim(),
      file_url: fileUrl,
      published: $('resourcePublished').checked
    };

    var saveBtn = $('resourceModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    var request = editingResourceId
      ? apiCall('PATCH', '/admin/resources/' + encodeURIComponent(editingResourceId), payload)
      : apiCall('POST', '/admin/resources', payload);

    request.then(function(result){
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      if(!result.data.ok){
        errorEl.textContent = (result.data.errors && result.data.errors[0]) || 'Failed to save resource.';
        return;
      }
      closeResourceModal();
      loadResources();
    }).catch(function(){
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      errorEl.textContent = 'Could not reach the backend.';
    });
  }

  function confirmDeleteResource(resourceId){
    pendingDelete = { type: 'resource', id: resourceId };
    $('confirmModalText').textContent = 'This resource will be permanently deleted. This cannot be undone.';
    $('confirmModal').style.display = 'flex';
  }

  // ============ IMPACT METRICS ============
  function loadImpactMetrics(){
    var list = $('impactList');
    list.innerHTML = '<p class="loading-state">Loading impact numbers…</p>';
    apiCall('GET', '/admin/impact-metrics').then(function(result){
      if(!result.data.ok){
        list.innerHTML = '<div class="error-state">' + escapeHtml((result.data.errors || ['Failed to load impact numbers.'])[0]) + '</div>';
        return;
      }
      state.impactMetrics = result.data.metrics;
      renderImpactMetrics();
    }).catch(function(){
      list.innerHTML = '<div class="error-state">Could not reach the backend.</div>';
    });
  }

  function renderImpactMetrics(){
    var list = $('impactList');
    if(state.impactMetrics.length === 0){
      list.innerHTML = '<p class="empty-state">No impact metrics found. These should be seeded automatically by schema.sql.</p>';
      return;
    }
    list.innerHTML = state.impactMetrics.map(function(m){
      return '' +
        '<div class="impact-row" data-metric-id="' + escapeHtml(m.id) + '">' +
          '<div class="impact-row-label">' + escapeHtml(m.label) + '</div>' +
          '<div class="impact-row-controls">' +
            '<input type="number" min="0" step="1" value="' + escapeHtml(m.value) + '" data-metric-value>' +
            '<label class="checkbox-row" style="margin:0;">' +
              '<input type="checkbox" data-metric-verified ' + (m.verified ? 'checked' : '') + '>' +
              '<span>Verified</span>' +
            '</label>' +
            '<button class="btn-sm" data-save-metric>Save</button>' +
          '</div>' +
        '</div>';
    }).join('');

    list.querySelectorAll('[data-save-metric]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var row = btn.closest('[data-metric-id]');
        var id = row.dataset.metricId;
        var valueInput = row.querySelector('[data-metric-value]');
        var verifiedInput = row.querySelector('[data-metric-verified]');
        var value = parseInt(valueInput.value, 10);

        if(!Number.isInteger(value) || value < 0){
          alert('Value must be a whole number, 0 or greater.');
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Saving…';
        apiCall('PATCH', '/admin/impact-metrics/' + encodeURIComponent(id), {
          value: value,
          verified: verifiedInput.checked
        }).then(function(result){
          btn.disabled = false;
          btn.textContent = 'Save';
          if(!result.data.ok){
            alert((result.data.errors && result.data.errors[0]) || 'Failed to save.');
            return;
          }
          loadImpactMetrics();
        }).catch(function(){
          btn.disabled = false;
          btn.textContent = 'Save';
          alert('Could not reach the backend.');
        });
      });
    });
  }

  // ============ SUBMISSIONS ============
  function loadSubmissions(){
    var list = $('submissionsList');
    var formType = $('submissionTypeSelect').value;
    list.innerHTML = '<p class="loading-state">Loading submissions…</p>';

    apiCall('GET', '/admin/submissions/' + encodeURIComponent(formType)).then(function(result){
      if(!result.data.ok){
        list.innerHTML = '<div class="error-state">' + escapeHtml((result.data.errors || ['Failed to load submissions.'])[0]) + '</div>';
        return;
      }
      renderSubmissions(result.data.submissions);
    }).catch(function(){
      list.innerHTML = '<div class="error-state">Could not reach the backend.</div>';
    });
  }

  function renderSubmissions(submissions){
    var list = $('submissionsList');
    if(submissions.length === 0){
      list.innerHTML = '<p class="empty-state">No submissions yet for this form.</p>';
      return;
    }
    list.innerHTML = submissions.map(function(s){
      var excludeKeys = ['id', 'formType', 'submittedAt'];
      var rows = Object.keys(s).filter(function(k){ return excludeKeys.indexOf(k) === -1 && s[k]; })
        .map(function(k){ return '<div><strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(s[k]) + '</div>'; })
        .join('');
      var when = s.submittedAt ? new Date(s.submittedAt).toLocaleString() : '';
      return '' +
        '<div class="item-card" style="flex-direction:column;align-items:stretch;">' +
          '<div class="item-card-meta" style="margin-bottom:8px;">' + escapeHtml(when) + '</div>' +
          '<div style="font-size:0.9rem;line-height:1.7;">' + rows + '</div>' +
        '</div>';
    }).join('');
  }

  // ============ WIRE EVERYTHING UP ============
  document.addEventListener('DOMContentLoaded', function(){
    setupTabs();

    $('loginBtn').addEventListener('click', attemptLogin);
    $('adminKeyInput').addEventListener('keydown', function(e){ if(e.key === 'Enter') attemptLogin(); });
    $('apiBaseInput').addEventListener('keydown', function(e){ if(e.key === 'Enter') attemptLogin(); });
    $('logoutBtn').addEventListener('click', logout);

    $('newStoryBtn').addEventListener('click', function(){ openStoryModal(null); });
    $('storyModalCancel').addEventListener('click', closeStoryModal);
    $('storyModalSave').addEventListener('click', saveStory);

    $('newResourceBtn').addEventListener('click', function(){ openResourceModal(null); });
    $('resourceModalCancel').addEventListener('click', closeResourceModal);
    $('resourceModalSave').addEventListener('click', saveResource);

    $('refreshSubmissionsBtn').addEventListener('click', loadSubmissions);
    $('submissionTypeSelect').addEventListener('change', loadSubmissions);

    $('confirmModalCancel').addEventListener('click', function(){
      pendingDelete = null;
      $('confirmModal').style.display = 'none';
    });
    $('confirmModalOk').addEventListener('click', function(){
      if(!pendingDelete) return;
      var okBtn = $('confirmModalOk');
      okBtn.disabled = true;
      okBtn.textContent = 'Deleting…';

      var path = pendingDelete.type === 'story'
        ? '/admin/stories/' + encodeURIComponent(pendingDelete.id)
        : '/admin/resources/' + encodeURIComponent(pendingDelete.id);

      apiCall('DELETE', path).then(function(result){
        okBtn.disabled = false;
        okBtn.textContent = 'Delete';
        $('confirmModal').style.display = 'none';
        if(!result.data.ok){
          alert((result.data.errors && result.data.errors[0]) || 'Failed to delete.');
          return;
        }
        if(pendingDelete.type === 'story') loadStories();
        else loadResources();
        pendingDelete = null;
      }).catch(function(){
        okBtn.disabled = false;
        okBtn.textContent = 'Delete';
        alert('Could not reach the backend.');
      });
    });
  });
})();
