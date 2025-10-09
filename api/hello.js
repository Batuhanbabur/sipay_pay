// api/hello.js
module.exports = (req, res) => {
  res.status(200).json({ ping: 'pong', method: req.method });
};
