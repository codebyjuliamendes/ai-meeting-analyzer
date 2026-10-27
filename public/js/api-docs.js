/* global SwaggerUIBundle */
'use strict';

window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({ url: '/swagger.json', dom_id: '#swagger-ui' });
});
