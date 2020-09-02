const { encode } = require('../consts');

class EscrowInterfaceEncoder {
    constructor(web3) {
        this.web3 = web3
    }
}
EscrowInterfaceEncoder.prototype.encodeIsUnderValued = function() {
    return encode(this.web3, 'isUnderValued()');
}

module.exports = EscrowInterfaceEncoder;