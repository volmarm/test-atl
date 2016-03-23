var wsd = require('websequencediagrams');
var fs = require('fs');
var crypto = require('crypto');

module.exports = function(app, addon) {

  // Root route. This route will serve the `atlassian-connect.json` unless the
  // plugin-info>param[documentation.url] inside `atlassian-connect.json` is set... else
  // it will redirect to that documentation URL.
  app.get('/',

    function(req, res) {
      res.format({
        // If the request content-type is text-html, it will decide which to serve up
        'text/html': function() {
          res.redirect(addon.descriptor.documentationUrl() || '/atlassian-connect.json');
        },
        // This logic is here to make sure that the `atlassian-connect.json` is always
        // served up when requested by the host.
        'application/json': function() {
          res.redirect('/atlassian-connect.json');
        }
      });
    }

  );

  // This is the controller for previewing the diagram inside
  // the macro dialog
  app.get('/preview.png',

    // preview requests are unauthenticated

    // Cache requests for a day
    require('cacheable-middleware')(86400000),

    function(req, res) {
      var str = decodeURIComponent(req.query.body);
      wsd.diagram(str, "rose", "png", function(err, buf, typ) {
        if (err) {
          console.error(err);
          res.send(500, err);
        } else {
          res.type('png');
          res.send(buf);
        }
      });

    });

  // This is the route that will handle the remote-macro. It will
  // make a call to WSD to render a PNG, then take that PNG and
  // upload it as an attachment to the page.
  app.get('/diagram', addon.authenticate(), require('cacheable-middleware')(86400000), function(req, res) {
    // Get web sequence diagram from http://www.websequencediagrams.com
    var macroHash = req.query.macroHash,
      pageId = req.query.pageId,
      pageVersion = req.query.pageVersion,
      userId = req.headers['ap-ctx-user-id'];

    var macroBodyUri = '/rest/api/content/' + pageId + '/history/' + pageVersion + '/macro/hash/' + macroHash;

    console.log("macro body uri", macroBodyUri);

    addon.httpClient(req).get({
      uri: macroBodyUri,
      userId: userId
    }, function(err, response, body) {
      if (err) {
        console.log("Error retrieving macro body: " + err);
        writeError(res, err);
      } else {
        try {
          console.log(body);
          var diagramBody = JSON.parse(body);
          console.log(diagramBody);
          console.log("Saving diagram as attachment");
          saveDiagramAsAttachment(req, pageId, userId, diagramBody);
        } catch (err) {
          console.log("Error saving attachment: " + err);
          writeError(res, err);
        }
      }
    });
  });

  function writeError(res, error) {
    res.render("error", {
      body: error
    });
  }

  function saveDiagramAsAttachment(req, pageId, userId, diagramBody) {
    wsd.diagram(diagramBody, "rose", "png", function(err, buf, typ) {
      if (err) {
        console.log("Error asking for diagram: " + err);
        writeError(res, err);
      } else {
        // Set up JSON to upload using Confluence's JSON-RPC service
        var uploadData = [pageId, {
            fileName: crypto.createHash('md5').update(diagramBody).digest('hex') + ".png",
            pageId: pageId,
            contentType: typ
          },
          buf.toString('base64') // convert buffer to base64
        ];

        console.log("diagram body " + diagramBody);

        // Upload to Confluence's addAttachment JSON-RPC service
        addon.httpClient(req).post({
          uri: '/rpc/json-rpc/confluenceservice-v2/addAttachment',
          json: uploadData,
          userId: userId
        }, function(err, resp, body) {
          var jsonRpcBody = body;
          if (!err && !jsonRpcBody.error) {
            // If the addAttachment service succeeds, then render the attached
            // image...
            res.render('diagram', body); // render Confluence XHTML format
          } else {
            console.log("Error saving attachment, rendering preview ", err, jsonRpcBody.error);
            // if it doesn't succeed, render the image from the addon
            // server... this makes it possible to render the image if
            // it's a new page
            var imgUrl = addon.config.localBaseUrl() + '/preview.png?body=' + encodeURIComponent(diagramBody);
            res.render('preview', {
              imgUrl: imgUrl
            });
          }
        });
      }
    });
  }

};