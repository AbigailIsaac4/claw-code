import React from 'react';
import { Typography, Tooltip, Button, theme } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { PlanStep } from '@/utils/messageParser';

const { Text } = Typography;
const { useToken } = theme;

interface Props {
  steps: PlanStep[];
  onExecuteStep: (fullBlock: string) => void;
}

export const PlanStepsCard: React.FC<Props> = ({ steps, onExecuteStep }) => {
  const { token } = useToken();
  if (!steps || steps.length < 2) return null;

  return (
    <div style={{ marginTop: 12, padding: '12px 16px', background: token.colorSuccessBg, border: `1px solid ${token.colorSuccessBorder}`, borderRadius: token.borderRadius }}>
      <Text strong style={{ fontSize: 13, color: token.colorSuccess, display: 'block', marginBottom: 8 }}>
        📋 检测到 {steps.length} 个执行步骤：
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((step) => (
          <div key={step.num} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: token.colorBgContainer, borderRadius: token.borderRadius, border: `1px solid ${token.colorSuccessBorder}` }}>
            <Text style={{ flex: 1, fontSize: 13 }}>
              <Text strong>Step {step.num}:</Text> {step.title}
            </Text>
            <Tooltip title="将此步骤填入输入框">
              <Button size="small" type="primary" icon={<PlayCircleOutlined />} style={{ background: token.colorSuccess, borderColor: token.colorSuccess }} onClick={() => onExecuteStep(step.fullBlock)}>
                执行
              </Button>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
};
