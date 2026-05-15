import React from 'react';
import { Typography, theme } from 'antd';
import { ClockCircleOutlined, CheckCircleFilled } from '@ant-design/icons';
import { PlanStep } from '@/utils/messageParser';

const { Text } = Typography;
const { useToken } = theme;

interface Props {
  steps: PlanStep[];
  isStreaming?: boolean;
}

export const PlanStepsCard: React.FC<Props> = ({ steps, isStreaming = false }) => {
  const { token } = useToken();
  if (!steps || steps.length === 0) return null;

  const activeStep = isStreaming ? steps.length : steps.length + 1;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((step, idx) => {
          const stepNum = idx + 1;
          const isActive = stepNum === activeStep;
          const isDone = stepNum < activeStep;
          
          return (
            <div key={step.num} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.85 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 14 }}>
                {isActive ? (
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: token.colorPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff', animation: 'pulse 1.5s infinite' }} />
                  </div>
                ) : isDone ? (
                  <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 12 }} />
                ) : (
                  <ClockCircleOutlined style={{ color: token.colorTextQuaternary, fontSize: 12 }} />
                )}
              </div>
              <Text style={{ 
                fontSize: 13, 
                color: isActive ? token.colorTextHeading : (isDone ? token.colorTextSecondary : token.colorTextTertiary),
                fontWeight: isActive ? 500 : 400
              }}>
                {step.title}
              </Text>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes pulse { 0% { opacity: 0.5; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0.5; transform: scale(0.8); } }
      `}</style>
    </div>
  );
};
