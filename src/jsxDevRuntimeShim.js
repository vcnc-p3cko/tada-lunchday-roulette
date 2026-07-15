// Astryx dist는 react/jsx-dev-runtime(jsxDEV)으로 컴파일되어 있는데,
// React 19 프로덕션 번들은 jsxDEV를 export하지 않는다 (void 0).
// 프로덕션 jsx/jsxs로 위임하는 shim을 package.json의 parcel alias로 연결한다.
const runtime = require('react/jsx-runtime');

exports.Fragment = runtime.Fragment;
exports.jsxDEV = function jsxDEV(type, config, maybeKey, isStaticChildren) {
  return (isStaticChildren ? runtime.jsxs : runtime.jsx)(type, config, maybeKey);
};
