/**
 * aiserver.v1.BidiService — Bidi 辅助服务
 *
 * 1 方法:
 *   - BidiAppend (unary) — 向 bidi 流追加消息
 *     SSE 降级模式下，客户端通过此方法发送 AgentClientMessage，
 *     data 字段包含 hex 编码的序列化 protobuf（也支持 data_binary），requestId 关联到 RunSSE 流。
 *
 * Transport: backendUrl (api2.cursor.sh)
 */
import { Code, ConnectError, type ConnectRouter } from '@connectrpc/connect';
import { BidiService } from '../../gen/aiserver_v1_pb';
import { appendMessage } from '../../handlers/agent/session';
import { logger } from '../../logger';

export default (router: ConnectRouter) => {
    router.service(BidiService, {
        bidiAppend: async (req) => {
            const requestId = req.requestId?.requestId;
            const data = req.dataBinary?.length ? req.dataBinary : req.data;
            if (!requestId || !data?.length) {
                throw new ConnectError('BidiAppend requires requestId and message data.', Code.InvalidArgument);
            }
            logger.info({ requestId, dataLen: data.length, seqno: Number(req.appendSeqno) }, '[SVC] BidiAppend');
            try { appendMessage(requestId, data); }
            catch (error) {
                throw new ConnectError((error as Error).message, Code.InvalidArgument);
            }
            return {};
        },
    });
};
